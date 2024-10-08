interface HTMLVideoElement {
  mozSrcObject?: HTMLVideoElement['srcObject'];
}

interface MediaTrackCapabilities {
  torch?: boolean;
  zoom?: {
    min: number;
    max: number;
    step: number;
  };
  exposureMode?: string[];
  exposureTime?: {
    min: number;
    max: number;
    step: number;
  };
}

interface MediaTrackConstraintSet {
  torch?: boolean;
  zoom?: number;
  exposureMode?: string;
  exposureTime?: number;
}

interface MediaTrackSettings {
  zoom?: number;
  torch?: boolean;
  exposureMode?: string;
  exposureTime?: number;
}
