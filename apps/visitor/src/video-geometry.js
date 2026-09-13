const SOURCE_ASPECT = 16 / 9;

/** Pixel box occupied by an object-contain video inside its stage. */
export function containedVideoBox(width, height, aspect = SOURCE_ASPECT) {
    if (!width || !height) return { left: 0, top: 0, width: 0, height: 0 };
    if (width / height > aspect) {
        const videoWidth = height * aspect;
        return { left: (width - videoWidth) / 2, top: 0, width: videoWidth, height };
    }
    const videoHeight = width / aspect;
    return { left: 0, top: (height - videoHeight) / 2, width, height: videoHeight };
}

export { SOURCE_ASPECT };
