export interface IStartCamera {
  constraints: MediaTrackConstraints;
  restart?: boolean;
  onRestarted: () => void;
}
