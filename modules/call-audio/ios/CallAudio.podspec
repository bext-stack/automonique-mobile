# SPDX-License-Identifier: Elastic-2.0
Pod::Spec.new do |s|
  s.name = 'CallAudio'
  s.version = '0.1.0'
  s.summary = 'Microphone capture and speech playback for one live call.'
  s.license = 'Elastic-2.0'
  s.author = 'bext'
  s.homepage = 'https://github.com/bext-stack/automonique-mobile'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => 'https://github.com/bext-stack/automonique-mobile.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'
  s.source_files = '*.swift'
end
