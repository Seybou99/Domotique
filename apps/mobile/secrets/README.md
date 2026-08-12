# Thing Security Guide

> Full document link: https://developer.tuya.com/docs/app-development/

## Getting Started

1. Unzip the tar and get the `xxx.aar` file.

2. Take the `xxx.aar` file into your `project/app/libs` folder.

3. Make suer you have the following code in your `project/app/build.gradle` file.

   ```groovy
   apply plugin: 'com.android.application'
   // xxx
   dependencies {
     implementation fileTree(include: ['*.aar'], dir: 'libs')
   }
   ```

4. Make sure you <font color='red'>don't have</font> this file in any of your directories：`t_s.bmp` .

5. Make sure your application 's `package name` is consistent with the Tuya's configuration.

6. Make sure your `AppKey` and `AppSecret` are consistent with the Tuya's configuration.

7. Make suer your `keystore file's SHA256` is configured in the Tuya's configuration. ([How to get the keystore's SHA256](https://developer.tuya.com/docs/iot/resignature-configuration?id=K9ijw4rj59tuq#title-5-%E5%A6%82%E4%BD%95%E6%9F%A5%E7%9C%8B%20Android%20App%20%E5%BA%94%E7%94%A8%E7%9A%84%20SHA256%20%E5%AF%86%E9%92%A5%EF%BC%9F) and [How to add the keystore's SHA256 in Tuya's platform](https://developer.tuya.com/docs/iot/resignature-configuration?id=K9ijw4rj59tuq#title-6-%E5%A6%82%E4%BD%95%E4%B8%BA%E6%B6%82%E9%B8%A6%20App%20SDK%20%E5%BA%94%E7%94%A8%E6%B7%BB%E5%8A%A0%20SHA256%20%E5%AF%86%E9%92%A5%EF%BC%9F))



## <font color='red'>Note for TRIAL_VERSION</font>

* If you are using the <font color='red'>trial version</font>, you may encounter a permission prompt of "applying for location" when the application starts, this is to prevent the trial version from being misused and put it on the application market.
* If you are using the <font color='red'>trial version</font>, there will be a <font color='red'>Toast</font> prompt when the application starts.



## QA

* Permission verification failed

  > The high probability is caused by incorrect algorithm-xxx.aar

* illegal client

  > It is necessary to check whether the **AppKey**, **AppSecret**,  **package name**,  **keystore‘s sha256**,    **algorithm-xxx.aar file** are consistent with the Tuya platform configuration. the [full issue doc](https://developer.tuya.com/docs/iot/resignature-configuration?id=K9ijw4rj59tuq#title-7-%E6%8A%A5%E9%94%99%E6%8E%92%E6%9F%A5).



