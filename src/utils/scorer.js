/**
 * scorer.js
 * Scoring algorithm for Violin Performance Rating System.
 * Calculates overall scores based on detected pitch and rhythm errors.
 */

/**
 * Score grade boundaries.
 */
const GRADE_BOUNDARIES = [
  { min: 95, grade: 'A+', label: 'Outstanding' },
  { min: 90, grade: 'A', label: 'Excellent' },
  { min: 85, grade: 'A-', label: 'Excellent' },
  { min: 80, grade: 'B+', label: 'Very Good' },
  { min: 75, grade: 'B', label: 'Very Good' },
  { min: 70, grade: 'B-', label: 'Good' },
  { min: 65, grade: 'C+', label: 'Good' },
  { min: 60, grade: 'C', label: 'Satisfactory' },
  { min: 55, grade: 'C-', label: 'Satisfactory' },
  { min: 50, grade: 'D', label: 'Needs Work' },
  { min: 0, grade: 'F', label: 'Needs Improvement' },
];

/**
 * Default scoring weights and penalties.
 */
const DEFAULT_SCORING = {
  /**
   * Maximum possible score (100).
   * @type {number}
   */
  maxScore: 100,

  /**
   * Base score when no errors are detected.
   * @type {number}
   */
  perfectScore: 100,

  /**
   * Weight for pitch accuracy component.
   * @type {number}
   */
  pitchWeight: 0.6, // 60% of score

  /**
   * Weight for rhythm accuracy component.
   * @type {number}
   */
  rhythmWeight: 0.4, // 40% of score

  /**
   * Penalty per low-severity pitch error.
   * @type {number}
   */
  pitchPenaltyLow: 1.0,

  /**
   * Penalty per medium-severity pitch error.
   * @type {number}
   */
  pitchPenaltyMedium: 2.5,

  /**
   * Penalty per high-severity pitch error.
   * @type {number}
   */
  pitchPenaltyHigh: 5.0,

  /**
   * Penalty per low-severity rhythm error.
   * @type {number}
   */
  rhythmPenaltyLow: 0.5,

  /**
   * Penalty per medium-severity rhythm error.
   * @type {number}
   */
  rhythmPenaltyMedium: 1.5,

  /**
   * Penalty per high-severity rhythm error.
   * @type {number}
   */
  rhythmPenaltyHigh: 3.0,

  /**
   * Bonus for overall accuracy (no errors above 'low' severity).
   * @type {number}
   */
  accuracyBonus: 2.0,

  /**
   * Bonus for consistent vibrato (if detectable).
   * @type {number}
   */
  vibratoBonus: 1.0,
};

/**
 * Scorer class calculates performance scores from error analysis.
 */
export class Scorer {
  constructor(options = {}) {
    this.scoring = { ...DEFAULT_SCORING, ...options };
  }

  /**
   * Calculate overall score from detected errors.
   * 
   * @param {Array<PitchError>} pitchErrors - Array of pitch errors from ErrorDetector
   * @param {Array<RhythmError>} rhythmErrors - Array of rhythm errors from ErrorDetector
   * @param {Object} [metadata] - Additional metadata for scoring
   * @param {number} [metadata.duration] - Total performance duration in seconds
   * @param {number} [metadata.totalNotes] - Total number of notes played
   * @returns {ScoreResult} Complete score breakdown
   */
  calculateScore(pitchErrors, rhythmErrors, metadata = {}) {
    // Calculate individual component scores
    const pitchScore = this._calculatePitchScore(pitchErrors, metadata.totalNotes);
    const rhythmScore = this._calculateRhythmScore(rhythmErrors, metadata.duration);

    // Apply weights to get combined score
    const weightedPitch = pitchScore * this.scoring.pitchWeight;
    const weightedRhythm = rhythmScore * this.scoring.rhythmWeight;
    let totalScore = weightedPitch + weightedRhythm;

    // Apply bonuses (capped at maxScore)
    const bonuses = this._calculateBonuses(pitchErrors, rhythmErrors);
    totalScore = Math.min(this.scoring.maxScore, totalScore + bonuses.total);

    // Determine grade
    const grade = this._getGrade(totalScore);

    // Build detailed breakdown
    const breakdown = {
      pitch: {
        score: pitchScore,
        weight: this.scoring.pitchWeight,
        weightedScore: weightedPitch,
        errorCount: pitchErrors.length,
        bySeverity: this._countBySeverity(pitchErrors),
      },
      rhythm: {
        score: rhythmScore,
        weight: this.scoring.rhythmWeight,
        weightedScore: weightedRhythm,
        errorCount: rhythmErrors.length,
        bySeverity: this._countBySeverity(rhythmErrors),
      },
      bonuses: bonuses,
    };

    return {
      total: Math.round(totalScore * 100) / 100, // Round to 2 decimal places
      grade: grade.grade,
      gradeLabel: grade.label,
      pitch: Math.round(pitchScore * 100) / 100,
      rhythm: Math.round(rhythmScore * 100) / 100,
      breakdown,
      errors: {
        pitch: pitchErrors,
        rhythm: rhythmErrors,
      },
    };
  }

  /**
   * Calculate pitch accuracy score.
   * @private
   */
  _calculatePitchScore(pitchErrors, totalNotes) {
    let penalty = 0;

    for (const error of pitchErrors) {
      switch (error.severity) {
        case 'low':
          penalty += this.scoring.pitchPenaltyLow;
          break;
        case 'medium':
          penalty += this.scoring.pitchPenaltyMedium;
          break;
        case 'high':
          penalty += this.scoring.pitchPenaltyHigh;
          break;
      }
    }

    // Normalize by expected note count if provided
    let baseScore = this.scoring.perfectScore - penalty;

    if (totalNotes && totalNotes > 0) {
      // Penalize based on percentage of notes with errors
      const errorRate = pitchErrors.length / totalNotes;
      baseScore -= errorRate * 10; // Additional penalty for high error rate
    }

    return Math.max(0, baseScore);
  }

  /**
   * Calculate rhythm accuracy score.
   * @private
   */
  _calculateRhythmScore(rhythmErrors, duration) {
    let penalty = 0;

    for (const error of rhythmErrors) {
      switch (error.severity) {
        case 'low':
          penalty += this.scoring.rhythmPenaltyLow;
          break;
        case 'medium':
          penalty += this.scoring.rhythmPenaltyMedium;
          break;
        case 'high':
          penalty += this.scoring.rhythmPenaltyHigh;
          break;
      }
    }

    // Normalize by performance duration
    let baseScore = this.scoring.perfectScore - penalty;

    if (duration && duration > 0) {
      // Convert to errors per minute for fair comparison
      const errorsPerMinute = (rhythmErrors.length / duration) * 60;
      if (errorsPerMinute > 10) {
        baseScore -= (errorsPerMinute - 10) * 0.5;
      }
    }

    return Math.max(0, baseScore);
  }

  /**
   * Calculate bonus points for exceptional performance.
   * @private
   */
  _calculateBonuses(pitchErrors, rhythmErrors) {
    const bonuses = {
      accuracy: 0,
      vibrato: 0,
      total: 0,
    };

    // Accuracy bonus: no errors above 'low' severity
    const hasNoHighErrors =
      pitchErrors.every((e) => e.severity !== 'high') &&
      rhythmErrors.every((e) => e.severity !== 'high');

    if (hasNoHighErrors && pitchErrors.length + rhythmErrors.length < 5) {
      bonuses.accuracy = this.scoring.accuracyBonus;
    }

    bonuses.total = bonuses.accuracy + bonuses.vibrato;

    return bonuses;
  }

  /**
   * Count errors by severity level.
   * @private
   */
  _countBySeverity(errors) {
    return errors.reduce(
      (counts, error) => {
        if (counts[error.severity] !== undefined) {
          counts[error.severity]++;
        }
        return counts;
      },
      { low: 0, medium: 0, high: 0 }
    );
  }

  /**
   * Get letter grade and label for a numeric score.
   * @private
   */
  _getGrade(score) {
    for (const boundary of GRADE_BOUNDARIES) {
      if (score >= boundary.min) {
        return { grade: boundary.grade, label: boundary.label };
      }
    }
    return { grade: 'F', label: 'Needs Improvement' };
  }

  /**
   * Generate a human-readable score summary.
   * 
   * @param {ScoreResult} scoreResult - Result from calculateScore
   * @returns {string} Formatted summary string
   */
  generateSummary(scoreResult) {
    const lines = [
      `Overall Score: ${scoreResult.total} (${scoreResult.grade})`,
      `  Pitch: ${scoreResult.pitch.toFixed(1)}/100`,
      `  Rhythm: ${scoreResult.rhythm.toFixed(1)}/100`,
      '',
      'Error Breakdown:',
      `  Pitch Errors: ${scoreResult.breakdown.pitch.errorCount}`,
      `    Low: ${scoreResult.breakdown.pitch.bySeverity.low}, ` +
        `Medium: ${scoreResult.breakdown.pitch.bySeverity.medium}, ` +
        `High: ${scoreResult.breakdown.pitch.bySeverity.high}`,
      `  Rhythm Errors: ${scoreResult.breakdown.rhythm.errorCount}`,
      `    Low: ${scoreResult.breakdown.rhythm.bySeverity.low}, ` +
        `Medium: ${scoreResult.breakdown.rhythm.bySeverity.medium}, ` +
        `High: ${scoreResult.breakdown.rhythm.bySeverity.high}`,
    ];

    if (scoreResult.breakdown.bonuses.total > 0) {
      lines.push('', `Bonuses: +${scoreResult.breakdown.bonuses.total}`);
    }

    return lines.join('\n');
  }

  /**
   * Get feedback for improvement based on score breakdown.
   * 
   * @param {ScoreResult} scoreResult - Result from calculateScore
   * @returns {Array<string>} Array of feedback suggestions
   */
  getImprovementTips(scoreResult) {
    const tips = [];

    // Pitch feedback
    if (scoreResult.breakdown.pitch.bySeverity.high > 0) {
      tips.push(
        'Focus on playing the correct notes — several notes were significantly out of tune.'
      );
    } else if (scoreResult.breakdown.pitch.bySeverity.medium > 0) {
      tips.push(
        'Work on intonation — some notes were noticeably sharp or flat.'
      );
    } else if (scoreResult.breakdown.pitch.bySeverity.low > 0) {
      tips.push(
        'Minor pitch adjustments needed — aim for cleaner note attacks.'
      );
    }

    // Rhythm feedback
    if (scoreResult.breakdown.rhythm.bySeverity.high > 0) {
      tips.push(
        'Practice with a metronome to improve timing consistency.'
      );
    } else if (scoreResult.breakdown.rhythm.bySeverity.medium > 0) {
      tips.push(
        'Work on maintaining steady tempo throughout the piece.'
      );
    } else if (scoreResult.breakdown.rhythm.bySeverity.low > 0) {
      tips.push(
        'Minor rhythm adjustments — pay attention to note durations.'
      );
    }

    // Positive feedback
    if (tips.length === 0) {
      tips.push('Excellent performance! Keep practicing to maintain consistency.');
    }

    // Specific tips based on scores
    if (scoreResult.pitch - scoreResult.rhythm > 20) {
      tips.push(
        'Consider focusing more on rhythm while maintaining your strong pitch accuracy.'
      );
    } else if (scoreResult.rhythm - scoreResult.pitch > 20) {
      tips.push(
        'Your rhythm is solid! Focus more on pitch accuracy to improve overall score.'
      );
    }

    return tips;
  }
}

/**
 * ScoreResult type definition.
 * @typedef {Object} ScoreResult
 * @property {number} total - Overall score (0-100)
 * @property {string} grade - Letter grade (A+ to F)
 * @property {string} gradeLabel - Grade description
 * @property {number} pitch - Pitch component score (0-100)
 * @property {number} rhythm - Rhythm component score (0-100)
 * @property {Object} breakdown - Detailed score breakdown
 * @property {Array} errors - All detected errors
 */

// Export singleton instance
export const scorer = new Scorer();

export default scorer;
