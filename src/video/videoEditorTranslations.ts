// Video Editor Guide Translations

export const VIDEO_EDITOR_LANGUAGES = [
  { id: 'en', label: 'English', flag: '🇺🇸' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { id: 'fr', label: 'Français', flag: '🇫🇷' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺' },
  { id: 'zh', label: '中文', flag: '🇨🇳' },
  { id: 'ko', label: '한국어', flag: '🇰🇷' },
  { id: 'ja', label: '日本語', flag: '🇯🇵' },
] as const;

export type VideoEditorLanguage = typeof VIDEO_EDITOR_LANGUAGES[number]['id'];

interface VideoEditorTranslations {
  title: string;
  overview: string;
  overviewText: string;
  allButtons: string;
  topToolbar: string;
  projectsButton: string;
  infoButton: string;
  saveButton: string;
  exportButton: string;
  closeButton: string;
  canvasControls: string;
  lockButton: string;
  zoomSlider: string;
  scaleSlider: string;
  bottomControls: string;
  layersButton: string;
  addVideoButton: string;
  filmstrip: string;
  tips: string;
  troubleshooting: string;
  legal: string;
}

export const VIDEO_EDITOR_TRANSLATIONS: Record<VideoEditorLanguage, VideoEditorTranslations> = {
  en: {
    title: 'Video Editor Guide',
    overview: 'Overview',
    overviewText: 'The Video Editor is a powerful 4K layered video composition tool (3840×2160) that lets you create professional multi-layer video compositions with precise control over positioning, scaling, and layering. Compose multiple videos, position and scale them, save projects, and export in MP4 or ProRes 4444 MOV format.',
    allButtons: '📱 ALL BUTTONS EXPLAINED',
    topToolbar: 'Top Toolbar',
    projectsButton: '📁 Projects Button - Opens saved projects modal',
    infoButton: 'ℹ️ Info Button - Opens this comprehensive guide',
    saveButton: '💾 Save Button - Saves current composition',
    exportButton: '📤 Export Button - Exports composition to video file',
    closeButton: '❌ Close Button - Exits the Video Editor',
    canvasControls: 'Canvas Controls',
    lockButton: '🔓/🔒 Lock Button - Lock/unlock canvas for moving layers',
    zoomSlider: 'ZOOM Slider - Controls canvas zoom (8% to 50%)',
    scaleSlider: 'SCALE Slider - Controls selected layer size (10% to 500%)',
    bottomControls: 'Bottom Controls',
    layersButton: '📋 Layers - Manage layer order and delete layers',
    addVideoButton: '+ Add Video - Add new video layer to composition',
    filmstrip: 'Layer Filmstrip - Tap thumbnails to select layers',
    tips: 'Tips & Best Practices',
    troubleshooting: 'Troubleshooting',
    legal: '⚖️ Legal Notice'
  },
  de: {
    title: 'Video-Editor-Anleitung',
    overview: 'Übersicht',
    overviewText: 'Der Video-Editor ist ein leistungsstarkes 4K-Ebenen-Videokompositionswerkzeug (3840×2160), mit dem Sie professionelle mehrstufige Videokompositionen mit präziser Kontrolle über Positionierung, Skalierung und Schichtung erstellen können. Erstellen Sie mehrere Videos, positionieren und skalieren Sie sie, speichern Sie Projekte und exportieren Sie im MP4- oder ProRes 4444 MOV-Format.',
    allButtons: '📱 ALLE BUTTONS ERKLÄRT',
    topToolbar: 'Obere Symbolleiste',
    projectsButton: '📁 Projekte-Button - Öffnet gespeicherte Projekte',
    infoButton: 'ℹ️ Info-Button - Öffnet diese umfassende Anleitung',
    saveButton: '💾 Speichern-Button - Speichert aktuelle Komposition',
    exportButton: '📤 Export-Button - Exportiert Komposition in Videodatei',
    closeButton: '❌ Schließen-Button - Beendet den Video-Editor',
    canvasControls: 'Canvas-Steuerung',
    lockButton: '🔓/🔒 Sperr-Button - Canvas sperren/entsperren zum Verschieben von Ebenen',
    zoomSlider: 'ZOOM-Schieberegler - Steuert Canvas-Zoom (8% bis 50%)',
    scaleSlider: 'SKALIEREN-Schieberegler - Steuert Größe der ausgewählten Ebene (10% bis 500%)',
    bottomControls: 'Untere Steuerung',
    layersButton: '📋 Ebenen - Ebenenreihenfolge verwalten und Ebenen löschen',
    addVideoButton: '+ Video hinzufügen - Neue Videoebene zur Komposition hinzufügen',
    filmstrip: 'Ebenen-Filmstreifen - Miniaturansichten antippen, um Ebenen auszuwählen',
    tips: 'Tipps & Best Practices',
    troubleshooting: 'Fehlerbehebung',
    legal: '⚖️ Rechtlicher Hinweis'
  },
  fr: {
    title: 'Guide de l\'éditeur vidéo',
    overview: 'Aperçu',
    overviewText: 'L\'éditeur vidéo est un outil puissant de composition vidéo en couches 4K (3840×2160) qui vous permet de créer des compositions vidéo multicouches professionnelles avec un contrôle précis sur le positionnement, la mise à l\'échelle et la superposition. Composez plusieurs vidéos, positionnez-les et redimensionnez-les, enregistrez des projets et exportez au format MP4 ou ProRes 4444 MOV.',
    allButtons: '📱 TOUS LES BOUTONS EXPLIQUÉS',
    topToolbar: 'Barre d\'outils supérieure',
    projectsButton: '📁 Bouton Projets - Ouvre la modale des projets enregistrés',
    infoButton: 'ℹ️ Bouton Info - Ouvre ce guide complet',
    saveButton: '💾 Bouton Enregistrer - Enregistre la composition actuelle',
    exportButton: '📤 Bouton Exporter - Exporte la composition vers un fichier vidéo',
    closeButton: '❌ Bouton Fermer - Quitte l\'éditeur vidéo',
    canvasControls: 'Contrôles du canvas',
    lockButton: '🔓/🔒 Bouton Verrouiller - Verrouiller/déverrouiller le canvas pour déplacer les calques',
    zoomSlider: 'Curseur ZOOM - Contrôle le zoom du canvas (8% à 50%)',
    scaleSlider: 'Curseur ÉCHELLE - Contrôle la taille du calque sélectionné (10% à 500%)',
    bottomControls: 'Contrôles inférieurs',
    layersButton: '📋 Calques - Gérer l\'ordre des calques et supprimer des calques',
    addVideoButton: '+ Ajouter vidéo - Ajouter un nouveau calque vidéo à la composition',
    filmstrip: 'Bande de calques - Appuyez sur les miniatures pour sélectionner les calques',
    tips: 'Conseils et bonnes pratiques',
    troubleshooting: 'Dépannage',
    legal: '⚖️ Mention légale'
  },
  ru: {
    title: 'Руководство видеоредактора',
    overview: 'Обзор',
    overviewText: 'Видеоредактор - это мощный инструмент для создания многослойных видеокомпозиций 4K (3840×2160), который позволяет создавать профессиональные многослойные видеокомпозиции с точным контролем позиционирования, масштабирования и наслоения. Компонуйте несколько видео, позиционируйте и масштабируйте их, сохраняйте проекты и экспортируйте в форматы MP4 или ProRes 4444 MOV.',
    allButtons: '📱 ВСЕ КНОПКИ ОБЪЯСНЕНЫ',
    topToolbar: 'Верхняя панель инструментов',
    projectsButton: '📁 Кнопка Проекты - Открывает модальное окно сохраненных проектов',
    infoButton: 'ℹ️ Кнопка Инфо - Открывает это подробное руководство',
    saveButton: '💾 Кнопка Сохранить - Сохраняет текущую композицию',
    exportButton: '📤 Кнопка Экспорт - Экспортирует композицию в видеофайл',
    closeButton: '❌ Кнопка Закрыть - Выходит из видеоредактора',
    canvasControls: 'Элементы управления холстом',
    lockButton: '🔓/🔒 Кнопка Блокировка - Заблокировать/разблокировать холст для перемещения слоев',
    zoomSlider: 'Ползунок ZOOM - Управляет масштабированием холста (8% до 50%)',
    scaleSlider: 'Ползунок МАСШТАБ - Управляет размером выбранного слоя (10% до 500%)',
    bottomControls: 'Нижние элементы управления',
    layersButton: '📋 Слои - Управление порядком слоев и удаление слоев',
    addVideoButton: '+ Добавить видео - Добавить новый видеослой в композицию',
    filmstrip: 'Кинолента слоев - Нажмите на миниатюры для выбора слоев',
    tips: 'Советы и лучшие практики',
    troubleshooting: 'Устранение неполадок',
    legal: '⚖️ Юридическое уведомление'
  },
  zh: {
    title: '视频编辑器指南',
    overview: '概述',
    overviewText: '视频编辑器是一个功能强大的 4K 分层视频合成工具(3840×2160),让您能够创建专业的多层视频合成,精确控制定位、缩放和分层。合成多个视频,定位和缩放它们,保存项目并以 MP4 或 ProRes 4444 MOV 格式导出。',
    allButtons: '📱 所有按钮说明',
    topToolbar: '顶部工具栏',
    projectsButton: '📁 项目按钮 - 打开已保存的项目模态',
    infoButton: 'ℹ️ 信息按钮 - 打开此综合指南',
    saveButton: '💾 保存按钮 - 保存当前合成',
    exportButton: '📤 导出按钮 - 将合成导出为视频文件',
    closeButton: '❌ 关闭按钮 - 退出视频编辑器',
    canvasControls: '画布控件',
    lockButton: '🔓/🔒 锁定按钮 - 锁定/解锁画布以移动图层',
    zoomSlider: '缩放滑块 - 控制画布缩放(8% 到 50%)',
    scaleSlider: '比例滑块 - 控制所选图层大小(10% 到 500%)',
    bottomControls: '底部控件',
    layersButton: '📋 图层 - 管理图层顺序和删除图层',
    addVideoButton: '+ 添加视频 - 向合成添加新视频图层',
    filmstrip: '图层缩略图条 - 点击缩略图选择图层',
    tips: '提示和最佳实践',
    troubleshooting: '故障排除',
    legal: '⚖️ 法律声明'
  },
  ko: {
    title: '비디오 편집기 가이드',
    overview: '개요',
    overviewText: '비디오 편집기는 위치, 크기 조정 및 레이어링을 정밀하게 제어하여 전문적인 다층 비디오 합성을 만들 수 있는 강력한 4K 레이어 비디오 합성 도구(3840×2160)입니다. 여러 비디오를 합성하고 위치를 지정하고 크기를 조정하고 프로젝트를 저장하고 MP4 또는 ProRes 4444 MOV 형식으로 내보냅니다.',
    allButtons: '📱 모든 버튼 설명',
    topToolbar: '상단 도구 모음',
    projectsButton: '📁 프로젝트 버튼 - 저장된 프로젝트 모달 열기',
    infoButton: 'ℹ️ 정보 버튼 - 이 종합 가이드 열기',
    saveButton: '💾 저장 버튼 - 현재 합성 저장',
    exportButton: '📤 내보내기 버튼 - 합성을 비디오 파일로 내보내기',
    closeButton: '❌ 닫기 버튼 - 비디오 편집기 종료',
    canvasControls: '캔버스 컨트롤',
    lockButton: '🔓/🔒 잠금 버튼 - 레이어 이동을 위해 캔버스 잠금/잠금 해제',
    zoomSlider: 'ZOOM 슬라이더 - 캔버스 확대/축소 제어(8%에서 50%)',
    scaleSlider: 'SCALE 슬라이더 - 선택한 레이어 크기 제어(10%에서 500%)',
    bottomControls: '하단 컨트롤',
    layersButton: '📋 레이어 - 레이어 순서 관리 및 레이어 삭제',
    addVideoButton: '+ 비디오 추가 - 합성에 새 비디오 레이어 추가',
    filmstrip: '레이어 필름스트립 - 썸네일을 탭하여 레이어 선택',
    tips: '팁 및 모범 사례',
    troubleshooting: '문제 해결',
    legal: '⚖️ 법적 고지'
  },
  ja: {
    title: 'ビデオエディターガイド',
    overview: '概要',
    overviewText: 'ビデオエディターは、位置、スケーリング、レイヤリングを正確に制御してプロフェッショナルな多層ビデオ合成を作成できる強力な 4K レイヤービデオ合成ツール(3840×2160)です。複数のビデオを合成し、位置とスケールを調整し、プロジェクトを保存し、MP4 または ProRes 4444 MOV 形式でエクスポートします。',
    allButtons: '📱 すべてのボタンの説明',
    topToolbar: '上部ツールバー',
    projectsButton: '📁 プロジェクトボタン - 保存されたプロジェクトモーダルを開く',
    infoButton: 'ℹ️ 情報ボタン - この包括的なガイドを開く',
    saveButton: '💾 保存ボタン - 現在の合成を保存',
    exportButton: '📤 エクスポートボタン - 合成をビデオファイルにエクスポート',
    closeButton: '❌ 閉じるボタン - ビデオエディターを終了',
    canvasControls: 'キャンバスコントロール',
    lockButton: '🔓/🔒 ロックボタン - レイヤーを移動するためにキャンバスをロック/ロック解除',
    zoomSlider: 'ZOOM スライダー - キャンバスのズームを制御(8% から 50%)',
    scaleSlider: 'SCALE スライダー - 選択したレイヤーのサイズを制御(10% から 500%)',
    bottomControls: '下部コントロール',
    layersButton: '📋 レイヤー - レイヤーの順序を管理してレイヤーを削除',
    addVideoButton: '+ ビデオを追加 - 合成に新しいビデオレイヤーを追加',
    filmstrip: 'レイヤーフィルムストリップ - サムネイルをタップしてレイヤーを選択',
    tips: 'ヒントとベストプラクティス',
    troubleshooting: 'トラブルシューティング',
    legal: '⚖️ 法的通知'
  }
};
