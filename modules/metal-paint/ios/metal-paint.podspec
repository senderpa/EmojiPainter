require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'metal-paint'
  s.version        = package['version']
  s.summary        = package['description'] || 'MetalPaint Expo Module'
  s.description    = package['description'] || 'MetalPaint Expo Module'
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage'] || 'https://github.com'
  s.platform       = :ios, '15.1'
  s.swift_version  = '5.4'
  s.source         = { git: '', tag: "v#{s.version}" }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Metal', 'MetalKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
