export type AIItemType =
  | 'image_standard'
  | 'image_controlnet'
  | 'image_txt2img'
  | 'video_animatediff'
  | 'video_slowcinema'
  | 'video_transition'
  | 'video_transition_auto'   // RIFE morph: two images → video
  | 'video_slowmotion_auto'   // one-shot evolving dreamscape
  | 'video_v2v'               // video-to-video restyle
  | 'mesh3d_tripo'
  | 'mesh3d_procedural'
  | 'mesh3d_text2tripo'
  | 'mesh3d_sf3d'
  | 'mesh3d_hunyuan'
  | 'mesh3d_trellis2';

export type AIJobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface AILibraryItem {
  id: string;
  type: AIItemType;
  status: AIJobStatus;
  createdAt: number;
  coinCost: number;
  sourceUri: string;
  resultUri?: string;
  resultUris?: string[];   // all redo iterations (index 0 = first result)
  downloadUrl?: string;    // server-side relative path for re-downloading 3D models
  glbUri?: string;         // local path to GLB file for in-app 3D viewer
  thumbnailUri?: string;   // rendered snapshot of 3D model for library thumbnail
  jobId?: string;
  emojiId?: string;
  label?: string;
  frameCount?: number;
  preset?: string;      // slow cinema preset / controlnet module
  prompt?: string;      // txt2img prompt
  errorMsg?: string;
  source2Uri?: string;  // second image for transition
  sourceAspectRatio?: number; // w/h of source image — used to display video at correct ratio
}
