import type { Position } from "react-rnd";
import type Webamp from "webamp";
import type { Track } from "webamp";

type ButterChurnPreset = {
  getPreset: () => Promise<unknown>;
  name: string;
};

export type ButterChurnPresets = Record<string, ButterChurnPreset>;

export type ButterChurnWebampPreset = {
  name: string;
  preset: ButterChurnPreset;
};

type CloseWindow = {
  type: "CLOSE_WINDOW";
  windowId: string;
};

type EnableMilkdrop = {
  open: boolean;
  type: "ENABLE_MILKDROP";
};

type LoadButterchurn = {
  butterchurn: unknown;
  type: "GOT_BUTTERCHURN";
};

type LoadButterchurnPresets = {
  presets: ButterChurnWebampPreset[];
  type: "GOT_BUTTERCHURN_PRESETS";
};

type PresetRequested = {
  addToHistory: boolean;
  index: number;
  type: "PRESET_REQUESTED";
};

type SelectPresetAtIndex = {
  index: number;
  type: "SELECT_PRESET_AT_INDEX";
};

type SetFocusedWindow = {
  type: "SET_FOCUSED_WINDOW";
  window: string;
};

type UpdateTrackInfo = Track["metaData"] & {
  type: "SET_MEDIA_TAGS";
};

type UpdateWindowPositions = {
  positions: {
    main?: Position;
    milkdrop?: Position;
    playlist?: Position;
  };
  type: "UPDATE_WINDOW_POSITIONS";
};

export type WebampCI = Webamp & {
  store: {
    dispatch: (
      command:
        | CloseWindow
        | EnableMilkdrop
        | LoadButterchurn
        | LoadButterchurnPresets
        | PresetRequested
        | SelectPresetAtIndex
        | SetFocusedWindow
        | UpdateTrackInfo
        | UpdateWindowPositions
    ) => void;
    getState: () => {
      display?: {
        closed: boolean;
      };
      milkdrop?: {
        butterchurn?: unknown;
        presetHistory?: number[];
        presets?: ButterChurnPreset[];
      };
      playlist?: {
        currentTrack: number;
      };
      tracks: Track["metaData"][];
      windows?: {
        genWindows?: {
          main?: {
            position?: Position;
          };
          milkdrop?: {
            open?: boolean;
          };
          playlist?: {
            open?: boolean;
            position?: Position;
          };
        };
      };
    };
    subscribe: (listener: () => void) => () => void;
  };
};

declare global {
  interface Window {
    Webamp: typeof Webamp;
    butterchurn: {
      default: unknown;
    };
  }
}
