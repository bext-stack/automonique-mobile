Pod::Spec.new do |s|
  s.name = 'PairingScanner'
  s.version = '0.1.0'
  s.summary = 'On-device live QR scanning for Automonique pairing'
  s.description = s.summary
  s.license = { :type => 'Elastic-2.0', :file => '../../../LICENSE' }
  s.author = 'Automonique'
  s.homepage = 'https://github.com/bext-stack/automonique-mobile'
  s.source = { :git => 'https://github.com/bext-stack/automonique-mobile.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'VisionKit', 'AVFoundation'
  s.source_files = '**/*.swift'
end
