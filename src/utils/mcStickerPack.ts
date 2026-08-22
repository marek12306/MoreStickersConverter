export interface Sticker {
  id: string;
  image: string;
  previewImage?: string;
  title: string;
  stickerPackId: StickerPackMeta['id'];
  filename?: string;
  isAnimated?: boolean;
  readyToUpload?: boolean;
}

export interface StickerPackDynamic {
  version: number;
  refreshUrl: string;
}

export interface StickerPackMeta {
  id: string;
  title: string;
  author?: {
    name: string;
    url?: string;
  };
  logo: Sticker;

  dynamic?: StickerPackDynamic;
}

export interface StickerPack extends StickerPackMeta {
  stickers: Sticker[];
}
