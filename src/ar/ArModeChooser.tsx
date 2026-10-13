/**
 * ArModeChooser — shown when the 📽️ toolbar button is tapped with no
 * challenge running. Offers four creative modes:
 * 🎭 Face Filter · 🧱 AR Painting · 📽️ Animator · 🎨 Multipaint
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { AppText as Text } from '../emoji/AppText';

export type ArChooserLanguage = 'en' | 'de' | 'fr' | 'it' | 'ru' | 'ja' | 'ko' | 'zh';

interface ArModeChooserProps {
  visible: boolean;
  language?: ArChooserLanguage;
  onPickFaceFilter: () => void;
  /** AR Draw-compatible tracked-face Mask Mode (full and Lite builds). */
  onPickFrontCamera?: () => void;
  onPickArPainting: () => void;
  onPickAnimator: () => void;
  onClose: () => void;
  /** Lite / App-Store build: hide the Face ("Emoji Me") scene. */
  faceComingSoon?: boolean;
  /** Preserve the old Emoji Front Camera implementation but hide its entry. */
  hideEmojiFace?: boolean;
  /** Full build only: opens the native multiplayer MultiPainter lobby. */
  onPickMultipaint?: () => void;
  /** Opens the workspace in infinite-canvas Vector mode. */
  onPickVector?: () => void;
}

interface ChooserCopy {
  title: string;
  front: { title: string; subtitle: string };
  face: { title: string; subtitle: string };
  ar: { title: string; subtitle: string };
  animator: { title: string; subtitle: string };
  multipaint: { title: string; subtitle: string };
  vector: { title: string; subtitle: string };
  notSupported: string;
  cancel: string;
}

const COPY: Record<ArChooserLanguage, ChooserCopy> = {
  en: {
    title: 'Choose your mode',
    front: { title: 'Front Camera', subtitle: 'Spray a live mask that bends and moves with your face' },
    face: { title: 'Emoji Me', subtitle: 'Take a selfie and get a rigged emoji that mimics you' },
    ar: { title: 'AR Painting', subtitle: 'Paint emojis onto real walls around you' },
    animator: { title: 'Animator', subtitle: 'Frame-by-frame animation workspace' },
    multipaint: { title: 'Multipaint', subtitle: 'Live multiplayer emoji painting with others' },
    vector: { title: 'Vector', subtitle: 'Infinite canvas — zoom forever, strokes stay crisp' },
    notSupported: 'Not supported on this device',
    cancel: 'Cancel',
  },
  de: {
    title: "Wähle deinen Modus",
    front: { title: 'Front Camera', subtitle: 'Sprühe eine Live-Maske, die sich mit deinem Gesicht bewegt' },
    face: { title: 'Emoji Ich', subtitle: 'Mach ein Selfie und erhalte ein animiertes Emoji, das dich nachahmt' },
    ar: { title: 'AR-Malen', subtitle: 'Male Emojis auf echte Wände um dich herum' },
    animator: { title: 'Animator', subtitle: 'Frame-für-Frame Animationsstudio' },
    multipaint: { title: 'Multipaint', subtitle: 'Live Mehrspieler Emoji-Malen mit anderen' },
    vector: { title: 'Vektor', subtitle: 'Unendliche Leinwand — grenzenlos zoomen, immer gestochen scharf' },
    notSupported: 'Auf diesem Gerät nicht unterstützt',
    cancel: 'Abbrechen',
  },
  fr: {
    title: 'Choisis ton mode',
    front: { title: 'Front Camera', subtitle: 'Peins un masque vivant qui se déforme avec ton visage' },
    face: { title: 'Filtre Visage', subtitle: 'Peins un masque et vois-le en direct sur ton visage' },
    ar: { title: 'Peinture AR', subtitle: 'Peins des emojis sur les vrais murs autour de toi' },
    animator: { title: 'Animateur', subtitle: "Atelier d'animation image par image" },
    multipaint: { title: 'Multipaint', subtitle: "Peinture emoji multijoueur en direct avec d'autres" },
    vector: { title: 'Vecteur', subtitle: 'Toile infinie — zoome sans fin, traits toujours nets' },
    notSupported: 'Non pris en charge sur cet appareil',
    cancel: 'Annuler',
  },
  it: {
    title: 'Scegli la tua modalita',
    front: { title: 'Front Camera', subtitle: 'Dipingi una maschera viva che si deforma con il viso' },
    face: { title: 'Filtro Viso', subtitle: 'Dipingi una maschera e vedila dal vivo sul tuo viso' },
    ar: { title: 'Pittura AR', subtitle: 'Dipingi emoji sui muri reali intorno a te' },
    animator: { title: 'Animatore', subtitle: 'Studio di animazione fotogramma per fotogramma' },
    multipaint: { title: 'Multipaint', subtitle: 'Pittura emoji multiplayer dal vivo con altri' },
    vector: { title: 'Vettoriale', subtitle: 'Tela infinita — zoom senza limiti, tratti sempre nitidi' },
    notSupported: 'Non supportato su questo dispositivo',
    cancel: 'Annulla',
  },
  ru: {
    title: 'Выбери режим',
    front: { title: 'Front Camera', subtitle: 'Рисуй живую маску, которая движется вместе с лицом' },
    face: { title: 'Фильтр лица', subtitle: 'Нарисуй маску и увидь её вживую на своём лице' },
    ar: { title: 'AR-рисование', subtitle: 'Рисуй эмодзи на настоящих стенах вокруг тебя' },
    animator: { title: 'Аниматор', subtitle: 'Покадровая анимационная студия' },
    multipaint: { title: 'Multipaint', subtitle: 'Живой мультиплеер — рисуй эмодзи с другими' },
    vector: { title: 'Вектор', subtitle: 'Бесконечный холст — бесконечный зум, штрихи всегда чёткие' },
    notSupported: 'Не поддерживается на этом устройстве',
    cancel: 'Отмена',
  },
  ja: {
    title: 'モードを選ぼう',
    front: { title: 'Front Camera', subtitle: '顔と一緒に変形して動くライブマスクを描こう' },
    face: { title: 'フェイスフィルター', subtitle: 'マスクを描いて、自分の顔でライブ表示' },
    ar: { title: 'ARペイント', subtitle: '周りの本物の壁に絵文字を描こう' },
    animator: { title: 'アニメーター', subtitle: 'コマ撮りアニメーション制作' },
    multipaint: { title: 'マルチペイント', subtitle: '他のユーザーとリアルタイム絵文字ペイント' },
    vector: { title: 'ベクター', subtitle: '無限キャンバス — どこまでもズーム、線はいつも鮮明' },
    notSupported: 'このデバイスでは利用できません',
    cancel: 'キャンセル',
  },
  ko: {
    title: '모드를 선택하세요',
    front: { title: 'Front Camera', subtitle: '얼굴과 함께 변형되는 라이브 마스크를 그려 보세요' },
    face: { title: '페이스 필터', subtitle: '마스크를 그리고 얼굴에서 실시간으로 확인하세요' },
    ar: { title: 'AR 페인팅', subtitle: '주변의 실제 벽에 이모지를 그려보세요' },
    animator: { title: '애니메이터', subtitle: '프레임별 애니메이션 작업실' },
    multipaint: { title: '멀티페인트', subtitle: '다른 사람들과 실시간 이모지 페인팅' },
    vector: { title: '벡터', subtitle: '무한 캔버스 — 끝없이 확대해도 선이 선명해요' },
    notSupported: '이 기기에서는 지원되지 않습니다',
    cancel: '취소',
  },
  zh: {
    title: '选择你的模式',
    front: { title: 'Front Camera', subtitle: '绘制会随面部一起变形移动的实时面具' },
    face: { title: '面部滤镜', subtitle: '画一个面具，实时显示在你的脸上' },
    ar: { title: 'AR绘画', subtitle: '在你周围的真实墙面上画表情符号' },
    animator: { title: '动画师', subtitle: '逐帧动画工作室' },
    multipaint: { title: '多人绘画', subtitle: '与其他人实时多人表情符号绘画' },
    vector: { title: '矢量', subtitle: '无限画布 — 无限缩放，笔画始终清晰' },
    notSupported: '此设备不支持',
    cancel: '取消',
  },
};

const COMING_SOON: Record<ArChooserLanguage, string> = {
  en: 'Coming soon',
  de: 'Demnächst',
  fr: 'Bientôt disponible',
  it: 'Prossimamente',
  ru: 'Скоро',
  ja: '近日公開',
  ko: '곧 제공 예정',
  zh: '即将推出',
};

const OPTION_KEYS = ['front', 'ar', 'animator', 'vector', 'multipaint', 'face'] as const;
const OPTION_ICONS: Record<(typeof OPTION_KEYS)[number], string> = {
  front: '🤳',
  face: '🎭',
  ar: '🧱',
  animator: '📽️',
  vector: '🔷',
  multipaint: '🎨',
};

const ArModeChooser: React.FC<ArModeChooserProps> = ({
  visible,
  language = 'en',
  onPickFaceFilter,
  onPickFrontCamera,
  onPickArPainting,
  onPickAnimator,
  onClose,
  faceComingSoon = false,
  hideEmojiFace = false,
  onPickMultipaint,
  onPickVector,
}) => {
  if (!visible) return null;

  const copy = COPY[language] ?? COPY.en;
  const comingSoonText = COMING_SOON[language] ?? COMING_SOON.en;

  const handlers: Record<(typeof OPTION_KEYS)[number], (() => void) | undefined> = {
    front: onPickFrontCamera,
    face: onPickFaceFilter,
    ar: onPickArPainting,
    animator: onPickAnimator,
    vector: onPickVector,
    multipaint: onPickMultipaint,
  };

  return (
    <View style={styles.backdropWrapper}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.panel}>
        <Text style={styles.title}>{copy.title}</Text>
        {OPTION_KEYS.map((key) => {
          const handler = handlers[key];
          // Hide multipaint if not provided (lite build)
          if (key === 'multipaint' && !handler) return null;
          // Omit only on platforms/builds that cannot expose the native scene.
          if (key === 'front' && !handler) return null;
          // The old scene stays in source/native code but is not listed.
          if (key === 'face' && hideEmojiFace) return null;
          // Hide vector only when the caller does not support it.
          if (key === 'vector' && !handler) return null;

          const isComingSoon = key === 'face' && faceComingSoon;
          if (isComingSoon) return null;

          const option = copy[key];
          const disabled = isComingSoon;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.optionButton, disabled && styles.optionDisabled]}
              onPress={() => {
                if (!disabled && handler) handler();
              }}
              disabled={disabled}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={option.title}
            >
              <Text style={styles.optionIcon}>{OPTION_ICONS[key]}</Text>
              <View style={styles.optionTextWrap}>
                <View style={styles.optionTitleRow}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  {isComingSoon && (
                    <View style={styles.soonBadge}>
                      <Text style={styles.soonBadgeText}>🔜 {comingSoonText}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.optionSubtitle}>
                  {isComingSoon ? comingSoonText : option.subtitle}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={copy.cancel}
        >
          <Text style={styles.cancelText}>{copy.cancel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdropWrapper: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  panel: {
    width: '86%',
    maxWidth: 420,
    backgroundColor: 'rgba(20,20,20,0.97)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 22,
    paddingHorizontal: 18,
    gap: 12,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionDisabled: { opacity: 0.55 },
  optionIcon: { fontSize: 34 },
  optionTextWrap: { flex: 1 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  soonBadge: {
    backgroundColor: 'rgba(255,159,107,0.18)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(255,159,107,0.5)',
  },
  soonBadgeText: { color: '#ff9f6b', fontSize: 10.5, fontWeight: '800' },
  optionTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  optionSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, marginTop: 2 },
  cancelButton: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: 'rgba(255,255,255,0.55)', fontSize: 15, fontWeight: '600' },
});

export default ArModeChooser;
