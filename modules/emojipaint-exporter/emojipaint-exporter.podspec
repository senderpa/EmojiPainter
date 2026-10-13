Pod::Spec.new do |s|
  s.name         = 'emojipaint-exporter'
  s.version      = '1.0.0'
  s.summary      = 'Local pod for Emojipaint Metal timelapse exporter'
  s.description  = 'Provides TimelapseExporterModule and related Metal exporter files.'
  s.license      = { :type => 'MIT' }
  s.author       = { 'emojipaint' => 'dev@emojipaint' }
  s.homepage     = 'https://example.com/emojipaint-exporter'
  s.source       = { :path => '.' }
  s.platform     = :ios, '13.0'

  s.source_files = 'ios/**/*.{swift,m,mm}'
  s.resources = ['ios/*.metal']
  s.requires_arc = true

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION' => '5.0'
  }

  s.frameworks = 'AVFoundation'
  s.dependency 'React-Core'
end
