export type UIElementId =
  | 'brush_tool'
  | 'line_tool'
  | 'eraser_tool'
  | 'emoji_plane_tool'
  | 'undo_button'
  | 'redo_button'
  | 'clear_button'
  | 'random_emoji'
  | 'emoji_picker_button'
  | 'color_picker'
  | 'brush_size'
  | 'info_button'
  | 'export_button'
  | 'timelapse_button'
  | 'trace_button'
  | 'challenge_timer'
  | 'gallery_button';

export type TutorialLanguage =
  | 'en' | 'de' | 'ru' | 'zh' | 'ko' | 'ja' | 'fr' | 'it';

export interface TouchRipple {
  id: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface TutorialCaption {
  elementId: UIElementId;
  text: string;
}
