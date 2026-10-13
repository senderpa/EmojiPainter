#!/usr/bin/env python3
"""
Automatically add Metal files to Xcode project
This modifies the project.pbxproj file directly
"""

import sys
import os
import uuid

def generate_uuid():
    """Generate a unique ID for Xcode"""
    return uuid.uuid4().hex[:24].upper()

def add_files_to_xcode():
    project_path = "ios/EmojiPainter.xcodeproj/project.pbxproj"

    if not os.path.exists(project_path):
        print("❌ Error: Xcode project not found")
        return False

    print("📝 Reading Xcode project...")
    with open(project_path, 'r') as f:
        content = f.read()

    # Check if files are already added
    if 'NativeAutosaveModule.swift' in content:
        print("✅ All Metal files already in project (including autosave)!")
        return True
    elif 'MetalCanvasModule.swift' in content:
        print("⚠️  Base Metal files found, adding snapshot module...")
        # Continue to add new files
    else:
        print("Adding all Metal files...")

    print("➕ Adding Metal files to project...")

    # Files to add
    files = [
        ('EmojiAtlas.swift', 'sourcecode.swift'),
        ('MetalCanvasModule.swift', 'sourcecode.swift'),
        ('MetalCanvasModule.m', 'sourcecode.c.objc'),
        ('StrokeLogModule.swift', 'sourcecode.swift'),
        ('StrokeLogModule.m', 'sourcecode.c.objc'),
        ('MP4ExporterModule.swift', 'sourcecode.swift'),
        ('MP4ExporterModule.m', 'sourcecode.c.objc'),
        ('NativeSnapshotModule.swift', 'sourcecode.swift'),
        ('NativeSnapshotModule.m', 'sourcecode.c.objc'),
        ('NativeAutosaveModule.swift', 'sourcecode.swift'),
        ('NativeAutosaveModule.m', 'sourcecode.c.objc'),
    ]

    # Generate UUIDs for each file
    file_refs = []
    build_files = []

    for filename, filetype in files:
        file_ref_id = generate_uuid()
        build_file_id = generate_uuid()

        file_refs.append({
            'id': file_ref_id,
            'name': filename,
            'path': f'EmojiPainter/MetalCanvas/{filename}',
            'type': filetype
        })

        build_files.append({
            'id': build_file_id,
            'file_ref': file_ref_id,
            'name': filename
        })

    # Find the PBXBuildFile section
    build_file_section = "/* Begin PBXBuildFile section */"
    build_file_idx = content.find(build_file_section)

    if build_file_idx == -1:
        print("❌ Could not find PBXBuildFile section")
        return False

    # Add build file entries
    insert_pos = content.find("/* End PBXBuildFile section */", build_file_idx)
    if insert_pos == -1:
        print("❌ Could not find end of PBXBuildFile section")
        return False

    build_file_entries = ""
    for bf in build_files:
        build_file_entries += f"\t\t{bf['id']} /* {bf['name']} in Sources */ = {{isa = PBXBuildFile; fileRef = {bf['file_ref']} /* {bf['name']} */; }};\n"

    content = content[:insert_pos] + build_file_entries + content[insert_pos:]

    # Find the PBXFileReference section
    file_ref_section = "/* Begin PBXFileReference section */"
    file_ref_idx = content.find(file_ref_section)

    if file_ref_idx == -1:
        print("❌ Could not find PBXFileReference section")
        return False

    # Add file reference entries
    insert_pos = content.find("/* End PBXFileReference section */", file_ref_idx)
    if insert_pos == -1:
        print("❌ Could not find end of PBXFileReference section")
        return False

    file_ref_entries = ""
    for fr in file_refs:
        file_ref_entries += f"\t\t{fr['id']} /* {fr['name']} */ = {{isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = {fr['type']}; path = {fr['name']}; sourceTree = \"<group>\"; }};\n"

    content = content[:insert_pos] + file_ref_entries + content[insert_pos:]

    # Find the main group and add MetalCanvas group
    main_group_section = "children = ("
    # We need to add our MetalCanvas folder reference

    # Find PBXGroup for EmojiPainter
    emoji_painter_group = content.find("/* EmojiPainter */ = {")
    if emoji_painter_group != -1:
        # Find the children array in this group
        children_start = content.find("children = (", emoji_painter_group)
        children_end = content.find(");", children_start)

        # Generate group ID
        metal_group_id = generate_uuid()

        # Add MetalCanvas group reference
        group_ref = f"\t\t\t\t{metal_group_id} /* MetalCanvas */,\n"
        content = content[:children_end] + group_ref + content[children_end:]

        # Add the MetalCanvas group definition
        group_section_end = content.find("/* End PBXGroup section */")

        metal_group_def = f"""\t\t{metal_group_id} /* MetalCanvas */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
"""
        for fr in file_refs:
            metal_group_def += f"\t\t\t\t{fr['id']} /* {fr['name']} */,\n"

        metal_group_def += f"""\t\t\t);
\t\t\tpath = MetalCanvas;
\t\t\tsourceTree = \"<group>\";
\t\t}};
"""
        content = content[:group_section_end] + metal_group_def + content[group_section_end:]

    # Find PBXSourcesBuildPhase and add our files
    sources_phase = content.find("/* Sources */ = {")
    if sources_phase != -1:
        files_start = content.find("files = (", sources_phase)
        files_end = content.find(");", files_start)

        source_refs = ""
        for bf in build_files:
            if bf['name'].endswith('.swift') or bf['name'].endswith('.m'):
                source_refs += f"\t\t\t\t{bf['id']} /* {bf['name']} in Sources */,\n"

        content = content[:files_end] + source_refs + content[files_end:]

    # Add Metal frameworks
    # Find PBXFrameworksBuildPhase
    frameworks_phase = content.find("/* Frameworks */ = {")
    if frameworks_phase != -1:
        files_start = content.find("files = (", frameworks_phase)
        files_end = content.find(");", files_start)

        # Check if Metal already added
        if "Metal.framework" not in content:
            metal_id = generate_uuid()
            metalkit_id = generate_uuid()
            metal_build_id = generate_uuid()
            metalkit_build_id = generate_uuid()

            # Add to build files
            build_file_section_end = content.find("/* End PBXBuildFile section */")
            metal_builds = f"""\t\t{metal_build_id} /* Metal.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {metal_id} /* Metal.framework */; }};
\t\t{metalkit_build_id} /* MetalKit.framework in Frameworks */ = {{isa = PBXBuildFile; fileRef = {metalkit_id} /* MetalKit.framework */; }};
"""
            content = content[:build_file_section_end] + metal_builds + content[build_file_section_end:]

            # Add file references
            file_ref_section_end = content.find("/* End PBXFileReference section */")
            metal_refs = f"""\t\t{metal_id} /* Metal.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = Metal.framework; path = System/Library/Frameworks/Metal.framework; sourceTree = SDKROOT; }};
\t\t{metalkit_id} /* MetalKit.framework */ = {{isa = PBXFileReference; lastKnownFileType = wrapper.framework; name = MetalKit.framework; path = System/Library/Frameworks/MetalKit.framework; sourceTree = SDKROOT; }};
"""
            content = content[:file_ref_section_end] + metal_refs + content[file_ref_section_end:]

            # Add to frameworks build phase
            framework_refs = f"""\t\t\t\t{metal_build_id} /* Metal.framework in Frameworks */,
\t\t\t\t{metalkit_build_id} /* MetalKit.framework in Frameworks */,
"""
            content = content[:files_end] + framework_refs + content[files_end:]

    print("💾 Writing updated project...")
    with open(project_path, 'w') as f:
        f.write(content)

    print("✅ Successfully added Metal files to Xcode project!")
    print("\n📋 Added files:")
    for filename, _ in files:
        print(f"   ✓ {filename}")

    print("\n🔗 Added frameworks:")
    print("   ✓ Metal.framework")
    print("   ✓ MetalKit.framework")

    return True

if __name__ == "__main__":
    print("🚀 Adding Metal modules to Xcode project...")
    print()

    if add_files_to_xcode():
        print("\n✅ Done! Now rebuild in Xcode:")
        print("   1. Open: open ios/EmojiPainter.xcworkspace")
        print("   2. Clean: Product → Clean Build Folder (⇧⌘K)")
        print("   3. Build: Product → Build (⌘B)")
        print("   4. Run: npx react-native run-ios --device")
        sys.exit(0)
    else:
        print("\n❌ Failed to add files")
        print("Please add files manually in Xcode")
        sys.exit(1)
