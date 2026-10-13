//
//  GameLanguage.swift
//  MultiPainter
//
//  Created by Claude Code
//

import Foundation

enum GameLanguage: String, CaseIterable {
    case english = "🇬🇧 English"
    case german = "🇩🇪 Deutsch"
    case french = "🇫🇷 Français"
    case spanish = "🇪🇸 Español"
    case italian = "🇮🇹 Italiano"
    case portuguese = "🇵🇹 Português"
    case japanese = "🇯🇵 日本語"
    case chinese = "🇨🇳 中文"

    var code: String {
        switch self {
        case .english: return "en"
        case .german: return "de"
        case .french: return "fr"
        case .spanish: return "es"
        case .italian: return "it"
        case .portuguese: return "pt"
        case .japanese: return "ja"
        case .chinese: return "zh"
        }
    }
}

class LocalizationManager: ObservableObject {
    @Published var currentLanguage: GameLanguage = .english

    static let shared = LocalizationManager()

    private init() {
        // Load saved language preference
        if let savedCode = UserDefaults.standard.string(forKey: "selectedLanguage"),
           let language = GameLanguage.allCases.first(where: { $0.code == savedCode }) {
            currentLanguage = language
        }
    }

    func setLanguage(_ language: GameLanguage) {
        currentLanguage = language
        UserDefaults.standard.set(language.code, forKey: "selectedLanguage")
    }

    func translate(_ key: LocalizedString) -> String {
        key.localized(for: currentLanguage)
    }
}

enum LocalizedString {
    // Settings Header
    case settingsTitle
    case howToPlayTitle
    case profileButton
    case closeButton

    // Game Rules
    case rule1Title
    case rule1Description
    case rule2Title
    case rule2Description
    case rule3Title
    case rule3Description
    case rule4Title
    case rule4Description
    case rule5Title
    case rule5Description
    case rule6Title
    case rule6Description

    // System Explanations
    case coinsTitle
    case coinsDescription
    case karmaTitle
    case karmaDescription
    case heartsTitle
    case heartsDescription
    case chatTitle
    case chatDescription
    case aiTitle
    case aiDescription

    func localized(for language: GameLanguage) -> String {
        let translations: [GameLanguage: String] = {
            switch self {
            case .settingsTitle:
                return [
                    .english: "How to Play",
                    .german: "Spielanleitung",
                    .french: "Comment jouer",
                    .spanish: "Cómo jugar",
                    .italian: "Come giocare",
                    .portuguese: "Como jogar",
                    .japanese: "遊び方",
                    .chinese: "如何游戏"
                ]

            case .profileButton:
                return [
                    .english: "Profile",
                    .german: "Mein Profil",
                    .french: "Mon profil",
                    .spanish: "Mi perfil",
                    .italian: "Il mio profilo",
                    .portuguese: "Meu perfil",
                    .japanese: "プロフィール",
                    .chinese: "我的资料"
                ]

            case .rule1Title:
                return [
                    .english: "🎨 Paint Together Against AI",
                    .german: "🎨 Gemeinsam gegen die KI malen",
                    .french: "🎨 Peindre ensemble contre l'IA",
                    .spanish: "🎨 Pintar juntos contra IA",
                    .italian: "🎨 Dipingi insieme contro l'IA",
                    .portuguese: "🎨 Pintar juntos contra IA",
                    .japanese: "🎨 AIと対戦して一緒に描く",
                    .chinese: "🎨 一起对抗AI绘画"
                ]

            case .rule1Description:
                return [
                    .english: "You and other players paint on a shared canvas. Every 60 seconds, the AI picks a random tile and transforms your art!",
                    .german: "Du und andere Spieler malen auf einer gemeinsamen Leinwand. Alle 60 Sekunden wählt die KI eine zufällige Kachel und transformiert eure Kunst!",
                    .french: "Vous et d'autres joueurs peignez sur un canevas partagé. Toutes les 60 secondes, l'IA choisit une tuile aléatoire et transforme votre art !",
                    .spanish: "Tú y otros jugadores pintan en un lienzo compartido. ¡Cada 60 segundos, la IA elige un azulejo aleatorio y transforma tu arte!",
                    .italian: "Tu e altri giocatori dipingete su una tela condivisa. Ogni 60 secondi, l'IA sceglie una tessera casuale e trasforma la vostra arte!",
                    .portuguese: "Você e outros jogadores pintam em uma tela compartilhada. A cada 60 segundos, a IA escolhe um azulejo aleatório e transforma sua arte!",
                    .japanese: "あなたと他のプレイヤーは共有キャンバスに描きます。60秒ごとに、AIがランダムなタイルを選んであなたのアートを変換します！",
                    .chinese: "你和其他玩家在共享画布上绘画。每60秒，AI会选择一个随机方块并转换你的艺术！"
                ]

            case .rule2Title:
                return [
                    .english: "⏱️ Random Tile Countdown",
                    .german: "⏱️ Zufällige Kachel-Countdown",
                    .french: "⏱️ Compte à rebours de tuile aléatoire",
                    .spanish: "⏱️ Cuenta regresiva de azulejo aleatorio",
                    .italian: "⏱️ Conto alla rovescia tessera casuale",
                    .portuguese: "⏱️ Contagem regressiva de azulejo aleatório",
                    .japanese: "⏱️ ランダムタイルカウントダウン",
                    .chinese: "⏱️ 随机方块倒计时"
                ]

            case .rule2Description:
                return [
                    .english: "Every minute, one tile gets selected randomly. The countdown shows which tile is next. When it hits 0, the AI processes that tile!",
                    .german: "Jede Minute wird eine Kachel zufällig ausgewählt. Der Countdown zeigt, welche Kachel als nächstes dran ist. Bei 0 verarbeitet die KI diese Kachel!",
                    .french: "Chaque minute, une tuile est sélectionnée au hasard. Le compte à rebours montre quelle tuile est la suivante. À 0, l'IA traite cette tuile !",
                    .spanish: "Cada minuto, un azulejo se selecciona al azar. La cuenta regresiva muestra qué azulejo es el siguiente. ¡Cuando llega a 0, la IA procesa ese azulejo!",
                    .italian: "Ogni minuto, una tessera viene selezionata casualmente. Il conto alla rovescia mostra quale tessera è la prossima. A 0, l'IA elabora quella tessera!",
                    .portuguese: "A cada minuto, um azulejo é selecionado aleatoriamente. A contagem regressiva mostra qual azulejo é o próximo. Quando chega a 0, a IA processa esse azulejo!",
                    .japanese: "毎分、タイルがランダムに選択されます。カウントダウンは次のタイルを示します。0になると、AIがそのタイルを処理します！",
                    .chinese: "每分钟随机选择一个方块。倒计时显示下一个方块。当达到0时，AI会处理该方块！"
                ]

            case .rule3Title:
                return [
                    .english: "💰 Earn Coins & ☯️ Karma",
                    .german: "💰 Verdiene Münzen & ☯️ Karma",
                    .french: "💰 Gagner des pièces & ☯️ Karma",
                    .spanish: "💰 Gana monedas & ☯️ Karma",
                    .italian: "💰 Guadagna monete & ☯️ Karma",
                    .portuguese: "💰 Ganhe moedas & ☯️ Karma",
                    .japanese: "💰 コインとカルマを獲得",
                    .chinese: "💰 赚取金币和业力"
                ]

            case .rule3Description:
                return [
                    .english: "Paint to earn coins! Positive actions give good karma (+), negative actions give bad karma (-). Your karma affects your rank and rewards!",
                    .german: "Male, um Münzen zu verdienen! Positive Aktionen geben gutes Karma (+), negative Aktionen geben schlechtes Karma (-). Dein Karma beeinflusst deinen Rang und Belohnungen!",
                    .french: "Peignez pour gagner des pièces ! Les actions positives donnent du bon karma (+), les actions négatives donnent du mauvais karma (-). Votre karma affecte votre rang et vos récompenses !",
                    .spanish: "¡Pinta para ganar monedas! Las acciones positivas dan buen karma (+), las acciones negativas dan mal karma (-). ¡Tu karma afecta tu rango y recompensas!",
                    .italian: "Dipingi per guadagnare monete! Le azioni positive danno buon karma (+), le azioni negative danno cattivo karma (-). Il tuo karma influenza il tuo grado e le ricompense!",
                    .portuguese: "Pinte para ganhar moedas! Ações positivas dão bom karma (+), ações negativas dão mau karma (-). Seu karma afeta sua classificação e recompensas!",
                    .japanese: "ペイントしてコインを獲得！ポジティブな行動は良いカルマ（+）、ネガティブな行動は悪いカルマ（-）を与えます。カルマはランクと報酬に影響します！",
                    .chinese: "绘画赚取金币！积极行动获得好业力（+），消极行动获得坏业力（-）。你的业力影响你的排名和奖励！"
                ]

            case .rule4Title:
                return [
                    .english: "❤️ Three Lives System",
                    .german: "❤️ Drei-Leben-System",
                    .french: "❤️ Système à trois vies",
                    .spanish: "❤️ Sistema de tres vidas",
                    .italian: "❤️ Sistema a tre vite",
                    .portuguese: "❤️ Sistema de três vidas",
                    .japanese: "❤️ 三つの命システム",
                    .chinese: "❤️ 三条生命系统"
                ]

            case .rule4Description:
                return [
                    .english: "You start with 3 hearts (lives). Paint on others' work to attack them. Lose all hearts and you respawn in 10 seconds with full health!",
                    .german: "Du startest mit 3 Herzen (Leben). Male über die Arbeit anderer, um sie anzugreifen. Verliere alle Herzen und du erscheinst in 10 Sekunden mit voller Gesundheit wieder!",
                    .french: "Vous commencez avec 3 cœurs (vies). Peignez sur le travail des autres pour les attaquer. Perdez tous les cœurs et vous réapparaissez en 10 secondes avec une santé complète !",
                    .spanish: "Comienzas con 3 corazones (vidas). Pinta sobre el trabajo de otros para atacarlos. ¡Pierde todos los corazones y reapareces en 10 segundos con salud completa!",
                    .italian: "Inizi con 3 cuori (vite). Dipingi sul lavoro degli altri per attaccarli. Perdi tutti i cuori e riappari in 10 secondi con salute completa!",
                    .portuguese: "Você começa com 3 corações (vidas). Pinte sobre o trabalho dos outros para atacá-los. Perca todos os corações e você reaparece em 10 segundos com saúde completa!",
                    .japanese: "3つのハート（命）でスタート。他人の作品にペイントして攻撃します。すべてのハートを失うと、10秒でフル体力で復活します！",
                    .chinese: "你从3颗心（生命）开始。在别人的作品上绘画来攻击他们。失去所有的心，10秒后满血复活！"
                ]

            case .rule5Title:
                return [
                    .english: "💬 Chat Affects AI!",
                    .german: "💬 Chat beeinflusst KI!",
                    .french: "💬 Le chat affecte l'IA !",
                    .spanish: "💬 ¡El chat afecta a la IA!",
                    .italian: "💬 La chat influenza l'IA!",
                    .portuguese: "💬 O chat afeta a IA!",
                    .japanese: "💬 チャットがAIに影響！",
                    .chinese: "💬 聊天影响AI！"
                ]

            case .rule5Description:
                return [
                    .english: "Your chat messages become AI prompts! Type 'sunset, mountains, purple sky' and the AI will try to create it. Be creative and guide the AI together!",
                    .german: "Deine Chat-Nachrichten werden zu KI-Prompts! Tippe 'Sonnenuntergang, Berge, lila Himmel' und die KI wird versuchen, es zu erstellen. Sei kreativ und steuere die KI gemeinsam!",
                    .french: "Vos messages de chat deviennent des invites d'IA ! Tapez 'coucher de soleil, montagnes, ciel violet' et l'IA essaiera de le créer. Soyez créatif et guidez l'IA ensemble !",
                    .spanish: "¡Tus mensajes de chat se convierten en indicaciones de IA! Escribe 'atardecer, montañas, cielo morado' y la IA intentará crearlo. ¡Sé creativo y guía a la IA juntos!",
                    .italian: "I tuoi messaggi di chat diventano prompt di IA! Digita 'tramonto, montagne, cielo viola' e l'IA cercherà di crearlo. Sii creativo e guida l'IA insieme!",
                    .portuguese: "Suas mensagens de chat se tornam prompts de IA! Digite 'pôr do sol, montanhas, céu roxo' e a IA tentará criá-lo. Seja criativo e guie a IA juntos!",
                    .japanese: "チャットメッセージがAIプロンプトになります！「夕焼け、山、紫の空」と入力すると、AIがそれを作成しようとします。創造的になり、一緒にAIを導きましょう！",
                    .chinese: "你的聊天消息变成AI提示词！输入'日落、山脉、紫色天空'，AI会尝试创建它。发挥创意，一起引导AI！"
                ]

            case .rule6Title:
                return [
                    .english: "🚀 Stay Active!",
                    .german: "🚀 Bleib aktiv!",
                    .french: "🚀 Restez actif !",
                    .spanish: "🚀 ¡Mantente activo!",
                    .italian: "🚀 Rimani attivo!",
                    .portuguese: "🚀 Fique ativo!",
                    .japanese: "🚀 アクティブに保つ！",
                    .chinese: "🚀 保持活跃！"
                ]

            case .rule6Description:
                return [
                    .english: "Paint, move, or chat every 30 seconds to stay in the game. After 30s of inactivity, you get a 10-second warning. Move to prevent being kicked to lobby!",
                    .german: "Male, bewege dich oder chatte alle 30 Sekunden, um im Spiel zu bleiben. Nach 30 Sekunden Inaktivität erhältst du eine 10-Sekunden-Warnung. Bewege dich, um nicht in die Lobby gekickt zu werden!",
                    .french: "Peignez, bougez ou discutez toutes les 30 secondes pour rester dans le jeu. Après 30s d'inactivité, vous recevez un avertissement de 10 secondes. Bougez pour éviter d'être expulsé vers le lobby !",
                    .spanish: "Pinta, muévete o chatea cada 30 segundos para permanecer en el juego. Después de 30s de inactividad, recibes una advertencia de 10 segundos. ¡Muévete para evitar ser expulsado al lobby!",
                    .italian: "Dipingi, muoviti o chatta ogni 30 secondi per rimanere in gioco. Dopo 30s di inattività, ricevi un avviso di 10 secondi. Muoviti per evitare di essere espulso nella lobby!",
                    .portuguese: "Pinte, mova-se ou converse a cada 30 segundos para ficar no jogo. Após 30s de inatividade, você recebe um aviso de 10 segundos. Mova-se para evitar ser expulso para o lobby!",
                    .japanese: "ゲームに留まるために30秒ごとにペイント、移動、またはチャットしてください。30秒間の非アクティブ後、10秒の警告が表示されます。ロビーにキックされるのを防ぐために移動してください！",
                    .chinese: "每30秒绘画、移动或聊天以留在游戏中。30秒不活动后，你会收到10秒警告。移动以防止被踢回大厅！"
                ]

            default:
                return [:]
            }
        }()

        return translations[language] ?? "..."
    }
}
