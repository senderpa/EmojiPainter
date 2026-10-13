//
//  ProfileEditorView.swift
//  MultiPainter
//
//  Created by Claude Code
//

import SwiftUI

struct ProfileEditorSheet: View {
    @Binding var isPresented: Bool
    var title: String = "Customize Profile"
    var onSave: (String, String) -> Void

    @State private var username: String
    @State private var selectedEmoji: String
    @State private var hasUserEditedName = false
    @State private var showEmojiPicker = false
    @State private var isSaving = false

    init(isPresented: Binding<Bool>, initialUsername: String, initialEmoji: String, title: String = "Customize Profile", onSave: @escaping (String, String) -> Void) {
        _isPresented = isPresented
        _username = State(initialValue: initialUsername)
        _selectedEmoji = State(initialValue: initialEmoji)
        self.title = title
        self.onSave = onSave
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.purple.opacity(0.9), Color.blue.opacity(0.9)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 24) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .appFont(32, weight: .bold)
                            .foregroundColor(.white)
                        Text("Choose how players see you")
                            .appFont(16, weight: .medium)
                            .foregroundColor(.white.opacity(0.7))
                    }

                    Spacer()

                    Button(action: {
                        isPresented = false
                    }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.white.opacity(0.8))
                            .appFont(28)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 20)

                VStack(spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Username")
                            .appFont(16, weight: .semibold)
                            .foregroundColor(.white)

                        TextField("Painter name", text: $username)
                            .textFieldStyle(CustomTextFieldStyle())
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .onChange(of: username) { _ in
                                hasUserEditedName = true
                            }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Avatar Emoji")
                            .appFont(16, weight: .semibold)
                            .foregroundColor(.white)

                        Button(action: {
                            showEmojiPicker = true
                        }) {
                            HStack {
                                CustomEmojiView(selectedEmoji, size: 64, revealOnTap: false)
                                Spacer()
                                Text("Tap to change")
                                    .foregroundColor(.white.opacity(0.7))
                                Image(systemName: "chevron.right")
                                    .foregroundColor(.white.opacity(0.6))
                            }
                            .padding()
                            .background(
                                RoundedRectangle(cornerRadius: 18)
                                    .fill(Color.white.opacity(0.15))
                            )
                        }
                    }
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 24)
                        .fill(Color.black.opacity(0.25))
                )
                .padding(.horizontal)

                Spacer()

                Button(action: saveProfile) {
                    HStack {
                        if isSaving {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .purple))
                        } else {
                            Text("Save Profile")
                                .appFont(20, weight: .bold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 60)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(Color.white)
                    )
                    .foregroundColor(.purple)
                }
                .padding(.horizontal)
                .padding(.bottom, 30)
            }

            if showEmojiPicker {
                FullEmojiPicker(selectedEmoji: $selectedEmoji, isPresented: $showEmojiPicker)
            }
        }
        .onAppear {
            if username.isEmpty {
                username = UserPreferences.shared.loadUsername() ?? RandomNameGenerator.randomName()
            }
            if selectedEmoji.isEmpty {
                selectedEmoji = UserPreferences.shared.loadEmoji() ?? EmojiData.randomEmoji()
            }
        }
    }

    private func saveProfile() {
        guard !isSaving else { return }
        let finalName = username.isEmpty ? RandomNameGenerator.randomName() : username

        isSaving = true
        UserPreferences.shared.saveUsername(finalName)
        UserPreferences.shared.saveEmoji(selectedEmoji)

        onSave(finalName, selectedEmoji)
        isSaving = false
        isPresented = false
    }
}

struct FullEmojiPicker: View {
    @Binding var selectedEmoji: String
    @Binding var isPresented: Bool

    var body: some View {
        ZStack {
            Color.black.opacity(0.7)
                .ignoresSafeArea()
                .onTapGesture {
                    isPresented = false
                }

            VStack(spacing: 0) {
                HStack {
                    Text("Choose Your Emoji")
                        .appFont(24, weight: .bold)
                        .foregroundColor(.white)

                    Spacer()

                    Button(action: {
                        selectedEmoji = EmojiData.randomEmoji()
                    }) {
                        Image(systemName: "shuffle")
                            .appFont(20)
                            .foregroundColor(.white)
                            .padding(8)
                            .background(Circle().fill(Color.purple))
                    }

                    Button(action: {
                        isPresented = false
                    }) {
                        Image(systemName: "xmark.circle.fill")
                            .appFont(28)
                            .foregroundColor(.white.opacity(0.7))
                    }
                }
                .padding()

                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 5), spacing: 12) {
                        ForEach(EmojiData.emojiList, id: \.self) { emoji in
                            Button(action: {
                                selectedEmoji = emoji
                                isPresented = false
                            }) {
                                CustomEmojiView(emoji, size: 32, revealOnTap: false)
                                    .frame(maxWidth: .infinity, minHeight: 60)
                                    .background(
                                        RoundedRectangle(cornerRadius: 12)
                                            .fill(selectedEmoji == emoji ? Color.purple.opacity(0.3) : Color.white.opacity(0.12))
                                    )
                            }
                        }
                    }
                    .padding()
                }
            }
            .frame(maxWidth: 500)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(Color.black.opacity(0.85))
            )
            .padding(30)
        }
    }
}

struct CustomTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding()
            .foregroundColor(.white)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.white.opacity(0.2))
            )
    }
}
