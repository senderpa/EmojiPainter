export type GlyphInstance = {
  emoji: string;
  x: number;
  y: number;
  size: number;
  opacity: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  textureIndex?: number;
};

export interface AnimatorRendererConfig {
  width: number;
  height: number;
  backgroundColor?: string;
}

export interface AnimatorRenderer {
  configure(config: AnimatorRendererConfig): Promise<void>;
  addGlyphToFrame(glyph: GlyphInstance, startFrame: number, lifetime: number): Promise<void>;
  clearAllFrames(): Promise<void>;
  clearFrame(index: number): Promise<void>;
  seekFrame(index: number, backgroundImage?: string | null): Promise<void>;
  renderOnionSkin(centerFrame: number, before: number, after: number, tint?: string): Promise<void>;
}

export class NoopAnimatorRenderer implements AnimatorRenderer {
  private config: AnimatorRendererConfig = { width: 512, height: 512 };

  async configure(config: AnimatorRendererConfig) {
    this.config = config;
  }

  async addGlyphToFrame(): Promise<void> {
    // no-op placeholder
  }

  async clearAllFrames(): Promise<void> {
    // no-op placeholder
  }

  async clearFrame(): Promise<void> {
    // no-op placeholder
  }

  async seekFrame(): Promise<void> {
    // no-op placeholder
  }

  async renderOnionSkin(): Promise<void> {
    // no-op placeholder
  }

  getConfig() {
    return this.config;
  }
}
