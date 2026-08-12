Pod::Spec.new do |s|
  s.name           = 'TuyaPairing'
  s.version        = '1.0.0'
  s.summary        = 'Appairage Wi-Fi Tuya, exposé à React Native.'
  s.license        = 'MIT'
  s.author         = 'Lumo'
  s.homepage       = 'https://github.com/Seybou99/Domotique'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/Seybou99/Domotique' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Lecture du réseau courant : le nom du Wi-Fi vient de NetworkExtension, et
  # iOS ne le livre qu'avec l'autorisation de localisation accordée.
  s.frameworks = 'NetworkExtension', 'CoreLocation'

  # Seule l'ombrelle : elle tire les sous-kits nécessaires, dont l'activateur.
  # Les bundles caméra, serrure ou aspirateur du Podfile d'exemple Tuya
  # alourdiraient le binaire de plusieurs dizaines de mégaoctets sans servir.
  s.dependency 'ThingSmartHomeKit', '~> 7.8.0'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
