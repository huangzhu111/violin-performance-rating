/**
 * dtw_aligner.js
 * Dynamic Time Warping (DTW) implementation for aligning two pitch sequences.
 * Used to compare a reference performance with a user's performance despite
 * tempo and timing differences.
 */

/**
 * DTWAligner class implements Dynamic Time Warping algorithm.
 * 
 * DTW finds the optimal alignment between two time series by warping the time axis.
 * This allows comparison of performances that differ in tempo.
 */
export class DTWAligner {
  constructor(options = {}) {
    /**
     * Window constraint for local slope ( Sakoe-Chiba band).
     * Restricts how far ahead/behind the alignment can jump.
     * @type {number}
     */
    this.window = options.window || Math.floor(Math.min(100, 50));

    /**
     * Weight for the tempo continuity penalty.
     * Higher values prefer smoother (more natural) alignments.
     * @type {number}
     */
    this.tempoPenalty = options.tempoPenalty || 0;

    /**
     * Enable parallel computation for large sequences.
     * @type {boolean}
     */
    this.parallel = options.parallel || false;
  }

  /**
   * Align two pitch sequences using Dynamic Time Warping.
   * 
   * @param {Array<{time: number, frequency: number}>} referencePitch - Reference pitch sequence
   * @param {Array<{time: number, frequency: number}>} userPitch - User pitch sequence
   * @returns {Object} Alignment result containing:
   *   - alignedReference: Aligned reference sequence indices
   *   - alignedUser: Aligned user sequence indices
   *   - distance: Total DTW distance
   *   - path: Array of [refIdx, userIdx] pairs
   */
  dtw_align(referencePitch, userPitch) {
    if (!referencePitch || referencePitch.length === 0) {
      throw new Error('Reference pitch sequence is empty');
    }
    if (!userPitch || userPitch.length === 0) {
      throw new Error('User pitch sequence is empty');
    }

    const n = referencePitch.length;
    const m = userPitch.length;

    // Create cost matrix (n x m)
    // Use typed array for better memory efficiency
    const costMatrix = new Float32Array(n * m);
    const pathMatrix = new Int32Array(n * m); // Store backpointer

    // Fill cost matrix
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const cost = this._distance(referencePitch[i], userPitch[j]);
        costMatrix[i * m + j] = cost;
        pathMatrix[i * m + j] = -1; // No path yet
      }
    }

    // Accumulate costs using DTW recurrence relation
    // D(i,j) = cost(i,j) + min(D(i-1,j), D(i-1,j-1), D(i,j-1))
    const INF = Infinity;

    // First cell
    costMatrix[0] = this._distance(referencePitch[0], userPitch[0]);

    // First row (can only come from left)
    for (let j = 1; j < m; j++) {
      if (j <= this.window) {
        costMatrix[0 * m + j] =
          costMatrix[0 * m + j] + costMatrix[0 * m + (j - 1)];
        pathMatrix[0 * m + j] = 0; // From left
      } else {
        costMatrix[0 * m + j] = INF;
      }
    }

    // First column (can only come from above)
    for (let i = 1; i < n; i++) {
      if (i <= this.window) {
        costMatrix[i * m + 0] =
          costMatrix[i * m + 0] + costMatrix[(i - 1) * m + 0];
        pathMatrix[i * m + 0] = 1; // From above
      } else {
        costMatrix[i * m + 0] = INF;
      }
    }

    // Fill rest of matrix with Sakoe-Chiba band constraint
    for (let i = 1; i < n; i++) {
      const jStart = Math.max(0, i - this.window);
      const jEnd = Math.min(m - 1, i + this.window);

      for (let j = jStart; j <= jEnd; j++) {
        if (i === 0 && j === 0) continue; // Skip first cell (already set)

        const idx = i * m + j;
        const cost = this._distance(referencePitch[i], userPitch[j]);

        // Get three possible predecessor costs
        const diagCost =
          i > 0 && j > 0 ? costMatrix[(i - 1) * m + (j - 1)] : INF;
        const leftCost = j > 0 ? costMatrix[i * m + (j - 1)] : INF;
        const upCost = i > 0 ? costMatrix[(i - 1) * m + j] : INF;

        // Add tempo penalty for large jumps (encourages smoother alignment)
        const diagPenalty = this.tempoPenalty * Math.abs(i - j);
        const leftPenalty = this.tempoPenalty * Math.abs(i - j + 1);
        const upPenalty = this.tempoPenalty * Math.abs(i - 1 - j);

        // Find minimum with penalties
        let minCost = diagCost + diagPenalty;
        let minPath = 2; // Diagonal

        if (leftCost + leftPenalty < minCost) {
          minCost = leftCost + leftPenalty;
          minPath = 0; // Left
        }
        if (upCost + upPenalty < minCost) {
          minCost = upCost + upPenalty;
          minPath = 1; // Up
        }

        costMatrix[idx] = cost + minCost;
        pathMatrix[idx] = minPath;
      }
    }

    // Backtrack to find optimal path
    const path = this._backtrack(pathMatrix, n, m);

    // Build aligned sequences from path
    const alignedReference = [];
    const alignedUser = [];

    for (const [refIdx, userIdx] of path) {
      alignedReference.push(refIdx);
      alignedUser.push(userIdx);
    }

    // Normalize total distance by path length for comparability
    const totalDistance = costMatrix[(n - 1) * m + (m - 1)];
    const normalizedDistance = totalDistance / path.length;

    return {
      alignedReference: alignedReference,
      alignedUser: alignedUser,
      distance: normalizedDistance,
      path,
      costMatrix: this._getReadableCostMatrix(costMatrix, n, m),
    };
  }

  /**
   * Compute distance between two pitch points.
   * Combines both pitch difference and timing difference.
   * 
   * @private
   * @param {Object} p1 - First pitch point {time, frequency}
   * @param {Object} p2 - Second pitch point {time, frequency}
   * @returns {number} Distance value (lower = more similar)
   */
  _distance(p1, p2) {
    // Handle invalid/missing frequencies
    if (!p1.frequency || !p2.frequency) {
      return 1000; // High penalty for missing pitch
    }

    // Pitch distance: semitone difference
    const semitoneDiff = 12 * Math.log2(p1.frequency / p2.frequency);
    const pitchCost = Math.abs(semitoneDiff);

    // Time distance: normalized by expected duration
    const timeDiff = Math.abs(p1.time - p2.time);
    const timeCost = timeDiff * 10; // Scale time penalty

    // Combined weighted distance
    return Math.sqrt(pitchCost * pitchCost + timeCost * timeCost);
  }

  /**
   * Backtrack through path matrix to reconstruct optimal alignment path.
   * 
   * @private
   * @param {Int32Array} pathMatrix - Backpointer matrix
   * @param {number} n - Reference sequence length
   * @param {number} m - User sequence length
   * @returns {Array<[number, number]>} Path as array of [refIdx, userIdx] pairs
   */
  _backtrack(pathMatrix, n, m) {
    const path = [];
    let i = n - 1;
    let j = m - 1;

    // Walk backwards from end to start
    while (i >= 0 && j >= 0) {
      path.unshift([i, j]);
      const pathType = pathMatrix[i * m + j];

      if (pathType === 2) {
        // Diagonal (i-1, j-1)
        i--;
        j--;
      } else if (pathType === 1) {
        // Up (i-1, j)
        i--;
      } else if (pathType === 0) {
        // Left (i, j-1)
        j--;
      } else {
        // No path (shouldn't happen in connected matrix)
        break;
      }
    }

    return path;
  }

  /**
   * Convert typed array cost matrix to 2D array for debugging/visualization.
   * 
   * @private
   * @param {Float32Array} matrix - Flat cost matrix
   * @param {number} n - Rows
   * @param {number} m - Columns
   * @returns {Array<Array<number>>} 2D cost matrix
   */
  _getReadableCostMatrix(matrix, n, m) {
    const result = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let j = 0; j < m; j++) {
        row.push(matrix[i * m + j]);
      }
      result.push(row);
    }
    return result;
  }

  /**
   * Compute local alignment score for a segment of the sequences.
   * Useful for finding similar phrases.
   * 
   * @param {Array<{time: number, frequency: number}>} reference - Reference pitch
   * @param {Array<{time: number, frequency: number}>} user - User pitch
   * @param {number} startRef - Start index in reference
   * @param {number} startUser - Start index in user
   * @param {number} length - Segment length
   * @returns {number} Local alignment score
   */
  computeLocalScore(reference, user, startRef, startUser, length) {
    let score = 0;
    let matches = 0;

    for (let i = 0; i < length; i++) {
      const refIdx = startRef + i;
      const userIdx = startUser + i;

      if (refIdx >= reference.length || userIdx >= user.length) break;

      const distance = this._distance(reference[refIdx], user[userIdx]);
      if (distance < 2) {
        matches++;
        score += 1 - distance / 2;
      }
    }

    return score / length;
  }
}

// Export singleton instance
export const dtwAligner = new DTWAligner();

export default dtwAligner;
