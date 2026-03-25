/**
 * error_detector.js
 * Error detection logic for comparing aligned reference and user performances.
 * Identifies pitch and rhythm deviations that affect the overall score.
 */

/**
 * Default thresholds for error detection.
 * Can be tuned based on skill level or specific requirements.
 */
const DEFAULT_THRESHOLDS = {
  /**
   * Maximum allowed pitch deviation in semitones before marking as error.
   * @type {number}
   */
  pitchThreshold: 0.5, // Half a semitone (perceptible to trained ears)

  /**
   * Maximum allowed timing deviation in seconds.
   * @type {number}
   */
  rhythmThreshold: 0.15, // 150ms

  /**
   * Minimum duration (seconds) to consider a segment valid.
   * Short segments are more prone to measurement error.
   * @type {number}
   */
  minSegmentDuration: 0.1,

  /**
   * Consecutive errors required before reporting (reduces noise).
   * @type {number}
   */
  minConsecutiveErrors: 1,

  /**
   * Weight for pitch errors vs rhythm errors (pitch is more important).
   * @type {number}
   */
  pitchWeight: 2.0,

  /**
   * Weight for rhythm errors.
   * @type {number}
   */
  rhythmWeight: 1.0,
};

/**
 * ErrorDetector class analyzes aligned sequences to identify performance errors.
 */
export class ErrorDetector {
  constructor(options = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options };
  }

  /**
   * Detect pitch errors between aligned reference and user performances.
   * 
   * @param {Array<number>} alignedRef - Aligned reference pitch indices
   * @param {Array<number>} alignedUser - Aligned user pitch indices
   * @param {Array<{time: number, frequency: number}>} referencePitch - Full reference pitch data
   * @param {Array<{time: number, frequency: number}>} userPitch - Full user pitch data
   * @param {number} [threshold] - Override pitch threshold in semitones
   * @returns {Array<PitchError>} Array of detected pitch errors
   */
  detectPitchErrors(
    alignedRef,
    alignedUser,
    referencePitch,
    userPitch,
    threshold = this.thresholds.pitchThreshold
  ) {
    const errors = [];

    for (let i = 0; i < alignedRef.length; i++) {
      const refIdx = alignedRef[i];
      const userIdx = alignedUser[i];

      const refPoint = referencePitch[refIdx];
      const userPoint = userPitch[userIdx];

      // Skip invalid points
      if (!refPoint || !refPoint.frequency) continue;
      if (!userPoint || !userPoint.frequency) {
        errors.push({
          type: 'pitch',
          subtype: 'missing',
          alignedIndex: i,
          refIndex: refIdx,
          userIndex: userIdx,
          time: refPoint.time,
          refFrequency: refPoint.frequency,
          userFrequency: null,
          deviation: null,
          severity: 'high',
          message: `Missing pitch at ${refPoint.time.toFixed(2)}s`,
        });
        continue;
      }

      // Calculate deviation in semitones
      const deviation = 12 * Math.log2(userPoint.frequency / refPoint.frequency);
      const absDeviation = Math.abs(deviation);

      // Check if deviation exceeds threshold
      if (absDeviation > threshold) {
        const severity = this._classifySeverity(absDeviation, threshold);

        errors.push({
          type: 'pitch',
          subtype: absDeviation > threshold * 2 ? 'wrong_note' : 'out_of_tune',
          alignedIndex: i,
          refIndex: refIdx,
          userIndex: userIdx,
          time: refPoint.time,
          refFrequency: refPoint.frequency,
          userFrequency: userPoint.frequency,
          deviation,
          deviationCents: deviation * 100, // Convert to cents
          severity,
          message: `Pitch ${severity}: ${refPoint.frequency.toFixed(1)}Hz → ${userPoint.frequency.toFixed(1)}Hz (${deviation.toFixed(2)} st)`,
        });
      }
    }

    // Merge consecutive errors into ranges
    return this._mergeConsecutiveErrors(errors, referencePitch);
  }

  /**
   * Detect rhythm/timing errors between aligned sequences.
   * 
   * @param {Array<number>} alignedRef - Aligned reference pitch indices
   * @param {Array<number>} alignedUser - Aligned user pitch indices
   * @param {Array<{time: number, frequency: number}>} referencePitch - Full reference pitch data
   * @param {Array<{time: number, frequency: number}>} userPitch - Full user pitch data
   * @param {number} [threshold] - Override rhythm threshold in seconds
   * @returns {Array<RhythmError>} Array of detected rhythm errors
   */
  detectRhythmErrors(
    alignedRef,
    alignedUser,
    referencePitch,
    userPitch,
    threshold = this.thresholds.rhythmThreshold
  ) {
    const errors = [];

    for (let i = 0; i < alignedRef.length - 1; i++) {
      const refIdx1 = alignedRef[i];
      const refIdx2 = alignedRef[i + 1];
      const userIdx1 = alignedUser[i];
      const userIdx2 = alignedUser[i + 1];

      const refPoint1 = referencePitch[refIdx1];
      const refPoint2 = referencePitch[refIdx2];
      const userPoint1 = userPitch[userIdx1];
      const userPoint2 = userPitch[userIdx2];

      // Skip if any points are invalid
      if (!refPoint1 || !refPoint2 || !userPoint1 || !userPoint2) continue;

      // Calculate interval durations
      const refDuration = refPoint2.time - refPoint1.time;
      const userDuration = userPoint2.time - userPoint1.time;

      // Skip very short intervals (likely noise)
      if (refDuration < this.thresholds.minSegmentDuration) continue;

      // Calculate timing deviation
      const deviation = userDuration - refDuration;
      const absDeviation = Math.abs(deviation);

      if (absDeviation > threshold) {
        const severity = this._classifySeverity(absDeviation, threshold);

        errors.push({
          type: 'rhythm',
          subtype:
            deviation > 0 ? 'too_slow' : 'too_fast',
          alignedIndex: i,
          refIndex: refIdx1,
          userIndex: userIdx1,
          time: refPoint1.time,
          refDuration,
          userDuration,
          deviation,
          severity,
          message: `Rhythm ${severity}: expected ${refDuration.toFixed(3)}s, got ${userDuration.toFixed(3)}s (${deviation > 0 ? '+' : ''}${(deviation * 1000).toFixed(0)}ms)`,
        });
      }
    }

    return this._mergeConsecutiveErrors(errors, referencePitch);
  }

  /**
   * Classify error severity based on magnitude.
   * 
   * @private
   * @param {number} deviation - Actual deviation
   * @param {number} threshold - Error threshold
   * @returns {'low' | 'medium' | 'high'} Severity level
   */
  _classifySeverity(deviation, threshold) {
    const ratio = deviation / threshold;
    if (ratio <= 1.5) return 'low';
    if (ratio <= 3) return 'medium';
    return 'high';
  }

  /**
   * Merge consecutive errors that are part of the same problem.
   * E.g., a string of out-of-tune notes should be reported as one continuous error.
   * 
   * @private
   * @param {Array} errors - Individual errors
   * @param {Array<{time: number}>} pitchData - Reference pitch for time lookup
   * @returns {Array} Merged errors
   */
  _mergeConsecutiveErrors(errors, pitchData) {
    if (errors.length === 0) return [];

    const merged = [];
    let currentRun = [errors[0]];

    for (let i = 1; i < errors.length; i++) {
      const prev = errors[i - 1];
      const curr = errors[i];

      // Check if consecutive (adjacent aligned indices)
      if (curr.alignedIndex === prev.alignedIndex + 1) {
        currentRun.push(curr);
      } else {
        // Finish current run and start new one
        merged.push(this._createRangeError(currentRun, pitchData));
        currentRun = [curr];
      }
    }

    // Don't forget the last run
    if (currentRun.length > 0) {
      merged.push(this._createRangeError(currentRun, pitchData));
    }

    return merged;
  }

  /**
   * Create a range error from a run of consecutive errors.
   * 
   * @private
   */
  _createRangeError(errorRun, pitchData) {
    const first = errorRun[0];
    const last = errorRun[errorRun.length - 1];

    // Calculate average deviation
    const avgDeviation =
      errorRun.reduce((sum, e) => sum + (e.deviation || 0), 0) / errorRun.length;

    return {
      ...first,
      endTime: last.time,
      startTime: first.time,
      duration: last.time - first.time,
      count: errorRun.length,
      avgDeviation,
      severity: this._classifySeverity(Math.abs(avgDeviation), this.thresholds.pitchThreshold),
      message: `${first.type === 'pitch' ? 'Pitch' : 'Rhythm'} error from ${first.time.toFixed(2)}s to ${last.time.toFixed(2)}s (${errorRun.length} points)`,
    };
  }

  /**
   * Get overall error statistics.
   * 
   * @param {Array<PitchError>} pitchErrors - All pitch errors
   * @param {Array<RhythmError>} rhythmErrors - All rhythm errors
   * @returns {Object} Error statistics
   */
  getErrorStats(pitchErrors, rhythmErrors) {
    const countErrors = (errors, subtype) =>
      errors.filter((e) => e.type === subtype).length;

    const countBySeverity = (errors) => {
      const counts = { low: 0, medium: 0, high: 0 };
      errors.forEach((e) => {
        if (counts[e.severity] !== undefined) counts[e.severity]++;
      });
      return counts;
    };

    return {
      pitch: {
        total: pitchErrors.length,
        bySeverity: countBySeverity(pitchErrors),
      },
      rhythm: {
        total: rhythmErrors.length,
        bySeverity: countBySeverity(rhythmErrors),
      },
      combined: {
        total: pitchErrors.length + rhythmErrors.length,
        weighted:
          pitchErrors.length * this.thresholds.pitchWeight +
          rhythmErrors.length * this.thresholds.rhythmWeight,
      },
    };
  }
}

/**
 * PitchError type definition.
 * @typedef {Object} PitchError
 * @property {'pitch'} type
 * @property {'out_of_tune'|'wrong_note'|'missing'} subtype
 * @property {number} alignedIndex
 * @property {number} refIndex
 * @property {number} userIndex
 * @property {number} time
 * @property {number|null} refFrequency
 * @property {number|null} userFrequency
 * @property {number|null} deviation - Deviation in semitones
 * @property {number|null} deviationCents
 * @property {'low'|'medium'|'high'} severity
 * @property {string} message
 */

/**
 * RhythmError type definition.
 * @typedef {Object} RhythmError
 * @property {'rhythm'} type
 * @property {'too_slow'|'too_fast'} subtype
 * @property {number} alignedIndex
 * @property {number} refIndex
 * @property {number} userIndex
 * @property {number} time
 * @property {number} refDuration
 * @property {number} userDuration
 * @property {number} deviation
 * @property {'low'|'medium'|'high'} severity
 * @property {string} message
 */

// Export singleton instance
export const errorDetector = new ErrorDetector();

export default errorDetector;
