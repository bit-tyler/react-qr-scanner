import {RefCallback, useEffect, useRef, useState} from 'react';

interface APLWindow {
    startX: number;
    startY: number;
    width: number;
    height: number;
}

interface UseWindowedExposureOptions {
    targetAPL?: number;
    getWindow?: (w: number, h: number) => APLWindow;
    updateInterval?: number; // Minimum time between exposure adjustments in milliseconds
}

interface UseWindowedExposureReturn {
    setVideoElementRef: RefCallback<HTMLVideoElement>;
    setCanvasRef: RefCallback<HTMLCanvasElement>;
    setVideoTrackRef: (v: MediaStreamTrack | null) => void;
}

const TARGET_APL = 100; // Default target APL - likely fine for most QR-code scanning purposes
const MIN_APL_DIFFERENCE = 5;
const EXPOSURE_TTL_MS = 200;
const DEFAULT_EXPOSURE_TIME = 500;
const WINDOW_RATIO = 0.2;

const defaultWindow = (width: number, height: number): APLWindow => {
    const windowSize = Math.min(width, height) * WINDOW_RATIO;
    return {
        startX: (width - windowSize) / 2,
        startY: (height - windowSize) / 2,
        width: windowSize,
        height: windowSize
    }
}

export function useWindowedExposure(options?: UseWindowedExposureOptions): UseWindowedExposureReturn {
    const {
        targetAPL = TARGET_APL,
        getWindow = defaultWindow,
        updateInterval = EXPOSURE_TTL_MS
    } = options || {};

    const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
    const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
    const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
    const currentAPLRef = useRef(TARGET_APL);
    const lastExposureUpdateRef = useRef<number>(0);
    const animationFrameIdRef = useRef<number>(0);
    const adjustingExposure = useRef<boolean>(false);
    const exposureControlAllowed = useRef<boolean>(false);
    const exposureTimeRef = useRef(DEFAULT_EXPOSURE_TIME);

    // Create the canvas element on the client side
    useEffect(() => {
        setCanvasElement(document.createElement("canvas"));
    }, []);

    useEffect(() => {
        if (!videoTrack) return;
        const capabilities = videoTrack.getCapabilities();
        if (capabilities.exposureTime && capabilities.exposureMode?.includes("manual")) {
            exposureControlAllowed.current = true;
            videoTrack.applyConstraints({
                advanced: [
                    {
                        exposureMode: "manual"
                    }
                ]
            } as MediaTrackConstraints);
        } else {
            console.error("The provided video track doesn't support manual exposure");
            exposureControlAllowed.current = false;
        }

        return () => {
            videoTrack.applyConstraints({
                advanced: [
                    { exposureMode: "continuous" }
                ]
            } as MediaTrackConstraints);
        };
    }, [videoTrack]);

    useEffect(() => {
        const processFrame = () => {
            if (!videoElement || !exposureControlAllowed || !getWindow || !videoTrack) return;
            if (
                canvasElement &&
                videoElement.readyState === videoElement.HAVE_ENOUGH_DATA &&
                exposureIsStale()
            ) {
                const ctx = canvasElement.getContext("2d", { willReadFrequently: true });
                if (ctx) {
                    // Draw the window region of the video frame to the canvas
                    const { startX, startY, width, height } = getWindow(videoElement.videoWidth, videoElement.videoHeight);
                    canvasElement.width = width;
                    canvasElement.height = height;
                    ctx.drawImage(videoElement, startX, startY, width, height, 0, 0, width, height);

                    const imageData = ctx.getImageData(0, 0, width, height);

                    // Compute the APL
                    currentAPLRef.current = approxAPL(imageData);
                    adjustExposure(currentAPLRef.current);
                }
            }
            animationFrameIdRef.current = requestAnimationFrame(processFrame);
        };

        animationFrameIdRef.current = requestAnimationFrame(processFrame);

        return () => {
            cancelAnimationFrame(animationFrameIdRef.current);
        };
    }, [targetAPL, videoElement, canvasElement, videoTrack]);

    const exposureIsStale = (): boolean => {
        return !adjustingExposure.current &&
            (Date.now() - lastExposureUpdateRef.current > updateInterval);
    }

    const aplInTargetRange = (apl: number): boolean => {
        return apl > targetAPL - MIN_APL_DIFFERENCE && apl < targetAPL + MIN_APL_DIFFERENCE;
    }

    const adjustExposure = (apl: number) => {
        if (!videoTrack) return;
        const capabilities = videoTrack.getCapabilities();
        if (!capabilities.exposureTime || !exposureControlAllowed.current || !exposureIsStale() || aplInTargetRange(apl)) {
            // Only update exposure at most once per updateInterval, and only if it's not close enough to the target
            return;
        }
        let newExposureTime = exposureTimeRef.current * (targetAPL / apl);

        // Browsers completely break if you attempt to set invalid exposure times
        newExposureTime = Math.max(
            capabilities.exposureTime.min,
            Math.min(capabilities.exposureTime.max, newExposureTime)
        );

        if (newExposureTime == exposureTimeRef.current) return;

        adjustingExposure.current = true;

        videoTrack
            .applyConstraints({
                advanced: [{ exposureTime: newExposureTime }],
            } as MediaTrackConstraints)
            .then(() => {
                exposureTimeRef.current = newExposureTime;
                lastExposureUpdateRef.current = Date.now();
                adjustingExposure.current = false;
            })
            .catch((err) => {
                console.error("Error adjusting exposure time:", err);
            });
    };

    const setVideoElementRef: RefCallback<HTMLVideoElement> = (el) => setVideoElement(el);
    const setCanvasRef: RefCallback<HTMLCanvasElement> = (el) => setCanvasElement(el);
    const setVideoTrackRef: RefCallback<MediaStreamTrack> = (track) => setVideoTrack(track);

    return {
        setVideoElementRef,
        setCanvasRef,
        setVideoTrackRef
    };
}

function approxAPL(imageData: ImageData, numSamples: number = 1000): number {
    // For 200x200 windows, 1000 samples comes within a few percentage points of the actual APL.
    // Override numSamples for larger window sizes, if necessary
    const { data, width, height } = imageData;
    let sum = 0;
    let count = 0;
    let totalPixels = width * height;
    numSamples = Math.min(totalPixels, numSamples);

    while (count < numSamples) {
        const index = Math.floor(Math.random() * totalPixels) * 4; // RGBA has 4 components per pixel
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];

        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        sum += luma;
        count++;
    }

    return count > 0 ? sum / count : 0;
}