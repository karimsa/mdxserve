# The app's own Expo module (apps/mobile/modules/selectable-text): autolinking finds it in the
# app's modules/ folder and builds it into the development build. Expo Go does not have it.
Pod::Spec.new do |s|
  s.name           = 'SelectableText'
  s.version        = '1.0.0'
  s.summary        = 'Selectable document text with a Comment item in its selection menu'
  s.description    = 'A non-editable UITextView fed styled runs, which reports the selection the reader comments on.'
  s.author         = ''
  s.homepage       = 'https://github.com/karimsa/mdxserve'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  # RCTGetFontWeight, to pick a font's face the way React Native's text does.
  s.dependency 'React-Core'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end
