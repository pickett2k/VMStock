import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Dimensions, RefreshControl } from 'react-native';
import { hybridSyncService } from '../services/HybridSyncService';
import { useTheme } from '../app/ThemeContext';
import { useIsFocused } from '@react-navigation/native';
import { useOrganization } from '../contexts/OrganizationContext';
import { formatCurrency } from '../utils/currency';

const { width } = Dimensions.get('window');

interface ReportEntry {
  date: string; // Date in DD.MM.YYYY format
  totalSales: number;
  totalRevenue: number;
  paidRevenue: number;
  unpaidRevenue: number;
}

export default function ReportsPage() {
  const [reportData, setReportData] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { isDarkMode } = useTheme();
  const isFocused = useIsFocused();
  const { organization } = useOrganization();

  // Generate earnings report from assignment data
  const loadReportData = async () => {
    setLoading(true);
    try {
      console.log('📊 ReportsPage: Loading assignments with provisional overlays');
      const assignments = await hybridSyncService.getAssignmentsWithOverlay();
      
      // Group assignments by date
      const dateGroups: { [date: string]: any[] } = {};
      
      assignments.forEach((assignment: any) => {
        // Extract just the date part from timestamp/date field
        let dateOnly: string;
        try {
          // Handle different date formats
          if (assignment.date) {
            const dateObj = new Date(assignment.date);
            if (!isNaN(dateObj.getTime())) {
              dateOnly = dateObj.toISOString().split('T')[0]; // Get YYYY-MM-DD format
            } else {
              dateOnly = assignment.date; // Use as-is if not a valid date
            }
          } else if (assignment.createdAt) {
            const dateObj = new Date(assignment.createdAt);
            if (!isNaN(dateObj.getTime())) {
              dateOnly = dateObj.toISOString().split('T')[0]; // Get YYYY-MM-DD format
            } else {
              dateOnly = new Date().toISOString().split('T')[0]; // Fallback to today
            }
          } else {
            dateOnly = new Date().toISOString().split('T')[0]; // Fallback to today
          }
        } catch (error) {
          console.warn('Error parsing date for assignment:', assignment, error);
          dateOnly = new Date().toISOString().split('T')[0]; // Fallback to today
        }
        
        if (!dateGroups[dateOnly]) {
          dateGroups[dateOnly] = [];
        }
        dateGroups[dateOnly].push(assignment);
      });
      
      // Calculate totals for each date
      const reports: ReportEntry[] = Object.keys(dateGroups)
        .map(date => {
          const dayAssignments = dateGroups[date];
          const totalSales = dayAssignments.length;
          const totalRevenue = dayAssignments.reduce((sum, assignment) => {
            const amount = assignment.total || assignment.totalAmount || 0;
            return sum + (typeof amount === 'number' ? amount : 0);
          }, 0);
          const paidRevenue = dayAssignments
            .filter(assignment => assignment.paid)
            .reduce((sum, assignment) => {
              const amount = assignment.total || assignment.totalAmount || 0;
              return sum + (typeof amount === 'number' ? amount : 0);
            }, 0);
          const unpaidRevenue = totalRevenue - paidRevenue;
          
          return {
            date,
            totalSales,
            totalRevenue,
            paidRevenue,
            unpaidRevenue
          };
        })
        .sort((a, b) => {
          // Sort by date (newest first)
          const dateA = new Date(a.date.split('.').reverse().join('-'));
          const dateB = new Date(b.date.split('.').reverse().join('-'));
          return dateB.getTime() - dateA.getTime();
        });
      
      setReportData(reports);
    } catch (error) {
      console.error('Error loading report data:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isFocused) {
      loadReportData();
    }
  }, [isFocused]);

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <Text style={[styles.header, isDarkMode && styles.darkHeader]}>Earnings Reports</Text>
      {reportData.length === 0 ? (
        <Text style={[styles.emptyMessage, isDarkMode && styles.darkEmptyMessage]}>
          {loading ? 'Loading earnings data...' : 'No sales history available.'}
        </Text>
      ) : (
        <FlatList
          data={reportData}
          keyExtractor={(item) => item.date}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={loadReportData} />
          }
          renderItem={({ item }) => (
            <View style={[styles.reportRow, isDarkMode && styles.darkReportRow]}>
              <View style={styles.dateSection}>
                <Text style={[styles.reportDate, isDarkMode && styles.darkReportDate]}>{item.date}</Text>
                <Text style={[styles.salesCount, isDarkMode && styles.darkSalesCount]}>
                  {item.totalSales} sale{item.totalSales !== 1 ? 's' : ''}
                </Text>
              </View>
              <View style={styles.totalsSection}>
                <Text style={[styles.totalRevenue, isDarkMode && styles.darkTotalRevenue]}>
                  {formatCurrency(item.totalRevenue, organization?.currency || 'GBP')}
                </Text>
                <View style={styles.paymentBreakdown}>
                  <Text style={[styles.paidAmount, isDarkMode && styles.darkPaidAmount]}>
                    Paid: {formatCurrency(item.paidRevenue, organization?.currency || 'GBP')}
                  </Text>
                  {item.unpaidRevenue > 0 && (
                    <Text style={[styles.unpaidAmount, isDarkMode && styles.darkUnpaidAmount]}>
                      Owed: {formatCurrency(item.unpaidRevenue, organization?.currency || 'GBP')}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: width > 600 ? 40 : 20,
    backgroundColor: '#fff',
  },
  darkContainer: {
    backgroundColor: '#1a1a1a',
  },
  header: {
    fontSize: width > 600 ? 24 : 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  darkHeader: {
    color: '#fff',
  },
  emptyMessage: {
    fontSize: width > 600 ? 18 : 16,
    fontStyle: 'italic',
    marginBottom: 10,
    color: '#777',
    textAlign: 'center',
    marginTop: 50,
  },
  darkEmptyMessage: {
    color: '#aaa',
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  darkReportRow: {
    borderBottomColor: '#555',
  },
  dateSection: {
    flex: 1,
  },
  reportDate: {
    fontSize: width > 600 ? 18 : 16,
    fontWeight: '500',
  },
  darkReportDate: {
    color: '#fff',
  },
  salesCount: {
    fontSize: width > 600 ? 14 : 12,
    color: '#666',
    marginTop: 2,
  },
  darkSalesCount: {
    color: '#999',
  },
  totalsSection: {
    alignItems: 'flex-end',
  },
  totalRevenue: {
    fontSize: width > 600 ? 18 : 16,
    fontWeight: 'bold',
    color: '#2e7d32',
  },
  darkTotalRevenue: {
    color: '#4caf50',
  },
  paymentBreakdown: {
    alignItems: 'flex-end',
    marginTop: 4,
  },
  paidAmount: {
    fontSize: width > 600 ? 12 : 10,
    color: '#4caf50',
  },
  darkPaidAmount: {
    color: '#81c784',
  },
  unpaidAmount: {
    fontSize: width > 600 ? 12 : 10,
    color: '#f57c00',
  },
  darkUnpaidAmount: {
    color: '#ffb74d',
  },
});
