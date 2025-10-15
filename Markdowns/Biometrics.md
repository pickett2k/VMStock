# LocalAuthentication

_A library that provides functionality for implementing the Fingerprint API (Android) or FaceID and TouchID (iOS) to authenticate the user with a face or fingerprint scan._

Available on platforms android, ios

`expo-local-authentication` allows you to use the Biometric Prompt (Android) or FaceID and TouchID (iOS) to authenticate the user with a fingerprint or face scan.

## Known limitation

### iOS&ensp;<PlatformTags platforms={['ios']} />

The FaceID authentication for iOS is not supported in Expo Go. You will need to create a [development build](https://docs.expo.dev/develop/development-builds/introduction/) to test FaceID.

## Installation

```bash
$ npx expo install expo-local-authentication
```

If you are installing this in an existing React Native app, make sure to install `expo` in your project.

## Configuration in app config

You can configure `expo-local-authentication` using its built-in [config plugin](https://docs.expo.dev/config-plugins/introduction/) if you use config plugins in your project ([EAS Build](https://docs.expo.dev/build/introduction) or `npx expo run:[android|ios]`). The plugin allows you to configure various properties that cannot be set at runtime and require building a new app binary to take effect.

```json app.json
{
  "expo": {
    "plugins": [
      [
        "expo-local-authentication",
        {
          "faceIDPermission": "Allow $(PRODUCT_NAME) to use Face ID."
        }
      ]
    ]
  }
}
```

### Configurable properties
| Name | Default | Description |
| --- | --- | --- |
| `faceIDPermission` | `"Allow $(PRODUCT_NAME) to use Face ID"` | Only for: ios. A string to set the [`NSFaceIDUsageDescription`](#permission-nsfaceidusagedescription) permission message. |

<ConfigReactNative>

If you're not using Continuous Native Generation ([CNG](https://docs.expo.dev/workflow/continuous-native-generation/)) or you're using a native **ios** project manually, then you need to add `NSFaceIDUsageDescription` key to your **ios/[app]/Info.plist**:

```xml Info.plist
<key>NSFaceIDUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to use FaceID</string>
```

</ConfigReactNative>

## API

```js
import * as LocalAuthentication from 'expo-local-authentication';
```

## API: expo-local-authentication

### LocalAuthentication Methods

#### authenticateAsync (*Function*)
- `authenticateAsync(options: LocalAuthenticationOptions): Promise<LocalAuthenticationResult>`
  Attempts to authenticate via Fingerprint/TouchID (or FaceID if available on the device).
  > **Note:** Apple requires apps which use FaceID to provide a description of why they use this API.
  If you try to use FaceID on an iPhone with FaceID without providing `infoPlist.NSFaceIDUsageDescription`
  in `app.json`, the module will authenticate using device passcode. For more information about
  usage descriptions on iOS, see [permissions guide](https://docs.expo.dev/guides/permissions/#ios).
  | Parameter | Type | Description |
  | --- | --- | --- |
  | `options` | LocalAuthenticationOptions | - |
  Returns: Returns a promise which fulfils with [`LocalAuthenticationResult`](#localauthenticationresult).

#### cancelAuthenticate (*Function*)
- `cancelAuthenticate(): Promise<void>`
  Cancels authentication flow.
  Available on platform: android

#### getEnrolledLevelAsync (*Function*)
- `getEnrolledLevelAsync(): Promise<SecurityLevel>`
  Determine what kind of authentication is enrolled on the device.
  Returns: Returns a promise which fulfils with [`SecurityLevel`](#securitylevel).
  > **Note:** On Android devices prior to M, `SECRET` can be returned if only the SIM lock has been
  enrolled, which is not the method that [`authenticateAsync`](#localauthenticationauthenticateasyncoptions)
  prompts.

#### hasHardwareAsync (*Function*)
- `hasHardwareAsync(): Promise<boolean>`
  Determine whether a face or fingerprint scanner is available on the device.
  Returns: Returns a promise which fulfils with a `boolean` value indicating whether a face or
  fingerprint scanner is available on this device.

#### isEnrolledAsync (*Function*)
- `isEnrolledAsync(): Promise<boolean>`
  Determine whether the device has saved fingerprints or facial data to use for authentication.
  Returns: Returns a promise which fulfils to `boolean` value indicating whether the device has
  saved fingerprints or facial data for authentication.

#### supportedAuthenticationTypesAsync (*Function*)
- `supportedAuthenticationTypesAsync(): Promise<AuthenticationType[]>`
  Determine what kinds of authentications are available on the device.
  Returns: Returns a promise which fulfils to an array containing [`AuthenticationType`s](#authenticationtype).

  Devices can support multiple authentication methods - i.e. `[1,2]` means the device supports both
  fingerprint and facial recognition. If none are supported, this method returns an empty array.

### Types

#### BiometricsSecurityLevel (*Type*)
Security level of the biometric authentication to allow.
Available on platform: android
Type: 'weak' | 'strong'

#### LocalAuthenticationError (*Type*)
One of the error values returned by the [`LocalAuthenticationResult`](#localauthenticationresult) object.
Type: 'not_enrolled' | 'user_cancel' | 'app_cancel' | 'not_available' | 'lockout' | 'no_space' | 'timeout' | 'unable_to_process' | 'unknown' | 'system_cancel' | 'user_fallback' | 'invalid_context' | 'passcode_not_set' | 'authentication_failed'

#### LocalAuthenticationOptions (*Type*)
| Property | Type | Description |
| --- | --- | --- |
| `biometricsSecurityLevel` *(optional)* | BiometricsSecurityLevel | Sets the security class of biometric authentication to allow.<br>`strong` allows only Android Class 3 biometrics. For example, a fingerprint or a 3D face scan.<br>`weak` allows both Android Class 3 and Class 2 biometrics. Class 2 biometrics are less secure than Class 3. For example, a camera-based face unlock. Default: `'weak'` Available on platform: android |
| `cancelLabel` *(optional)* | string | Allows customizing the default `Cancel` label shown. |
| `disableDeviceFallback` *(optional)* | boolean | After several failed attempts, the system falls back to the device passcode. This setting<br>allows you to disable this option and instead handle the fallback yourself. This can be<br>preferable in certain custom authentication workflows. This behaviour maps to using the iOS<br>[`LAPolicyDeviceOwnerAuthenticationWithBiometrics`](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthenticationwithbiometrics)<br>policy rather than the [`LAPolicyDeviceOwnerAuthentication`](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication?language=objc)<br>policy. Defaults to `false`. |
| `fallbackLabel` *(optional)* | string | Allows to customize the default `Use Passcode` label shown after several failed<br>authentication attempts. Setting this option to an empty string disables this button from<br>showing in the prompt. Available on platform: ios |
| `promptDescription` *(optional)* | string | A description displayed in the middle of the authentication prompt. Available on platform: android |
| `promptMessage` *(optional)* | string | A message that is shown alongside the TouchID or FaceID prompt. |
| `promptSubtitle` *(optional)* | string | A subtitle displayed below the prompt message in the authentication prompt. Available on platform: android |
| `requireConfirmation` *(optional)* | boolean | Sets a hint to the system for whether to require user confirmation after authentication.<br>This may be ignored by the system if the user has disabled implicit authentication in Settings<br>or if it does not apply to a particular biometric modality. Defaults to `true`. Available on platform: android |

#### LocalAuthenticationResult (*Type*)
| Property | Type | Description |
| --- | --- | --- |
| `success` | true | - |
| `error` | LocalAuthenticationError | - |
| `warning` *(optional)* | string | - |

### Enums

#### AuthenticationType (*Enum*)
#### Members
- `FACIAL_RECOGNITION` — Indicates facial recognition support.
- `FINGERPRINT` — Indicates fingerprint support.
- `IRIS` — Indicates iris recognition support.

#### SecurityLevel (*Enum*)
#### Members
- `BIOMETRIC_STRONG` — Indicates strong biometric authentication. For example, a fingerprint scan or 3D face unlock.
- `BIOMETRIC_WEAK` — Indicates weak biometric authentication. For example, a 2D image-based face unlock.
> There are currently no weak biometric authentication options on iOS.
- `NONE` — Indicates no enrolled authentication.
- `SECRET` — Indicates non-biometric authentication (e.g. PIN, Pattern).

## Permissions

### Android

The following permissions are added automatically through this library's **AndroidManifest.xml**:

<AndroidPermissions permissions={['USE_BIOMETRIC', 'USE_FINGERPRINT']} />

### iOS

The following usage description keys are used by this library:

<IOSPermissions permissions={['NSFaceIDUsageDescription']} />