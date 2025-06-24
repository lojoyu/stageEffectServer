/**
 * Splits text into sentences based on common punctuation.
 * Handles cases with no punctuation or empty input.
 * Removes trailing punctuation from the last sentence.
 * @param {string} text - The input text.
 * @returns {string[]} An array of sentences. Returns [''] for empty or null input.
 */
function txtToSentence(text) {
    if (!text || typeof text !== 'string') {
        console.warn('[Utils] txtToSentence received invalid input:', text);
        return ['']; // Return empty array or [''] for invalid input
    }

    // Add a temporary period to ensure the last sentence is matched if it doesn't end with punctuation
    const tempText = text + '.';
    // Regex to match one or more characters that are NOT punctuation, followed by one punctuation mark
    // Using [.,!?:;] as specified in structure.md
    const re = /[^.,!?:;]+[.,!?:;]+/g;
    let result = tempText.match(re);

    if (result === null || result === undefined) {
        // If no punctuation is found, treat the whole text as one sentence
        return [text.trim()];
    }

    // Remove the temporary period from the last matched sentence
    // The regex ensures the last character is punctuation, so we remove it.
    // Also trim whitespace from each sentence.
    // Let's re-evaluate the regex and post-processing based on the original index.js logic.
    // The original index.js logic added '.', matched, then removed the last char of the LAST result.
    // This means the last sentence *loses* its trailing punctuation. Let's replicate that.

    const reOriginal = /[^\.,!\?\:;]+[\.,!\?\:;]+/g;
    let sentencesWithPunct = (text + '.').match(reOriginal);

    if (!sentencesWithPunct) {
         return [text.trim()]; // No punctuation found
    }

    // Remove trailing punctuation from the last sentence as per original logic
    sentencesWithPunct[sentencesWithPunct.length - 1] = sentencesWithPunct[sentencesWithPunct.length - 1].slice(0, -1);

    // Trim whitespace from all sentences
    const finalSentences = sentencesWithPunct.map(sentence => sentence.trim()).filter(sentence => sentence.length > 0);

    // Handle case where trimming results in an empty array (e.g., input was just punctuation)
    return finalSentences.length > 0 ? finalSentences : [''];
}


/**
 * Calculates a suggested timeout duration for a speak action based on text length and rate.
 * @param {string} text - The text to be spoken.
 * @param {number} [rate] - The speech rate (e.g., 1.0 is normal). Higher rate means shorter duration.
 * @param {number} baseDelayMs - A base delay in milliseconds.
 * @param {number} speedFactor - A multiplier for text length to get base duration.
 * @returns {number} The calculated timeout duration in milliseconds.
 */
function calculateSpeakTimeout(text, rate, baseDelayMs, speedFactor) {
    if (typeof text !== 'string' || text.length === 0) {
        return baseDelayMs || 0; // Return base delay or 0 for empty text
    }

    const textLength = text.length;
    let duration = textLength * (speedFactor || 200); // Default speedFactor if not provided

    if (typeof rate === 'number' && rate > 0) {
        duration /= rate;
    }

    // Add base delay
    duration += (baseDelayMs || 700); // Default baseDelayMs if not provided

    return Math.ceil(duration); // Return as integer
}


module.exports = {
    txtToSentence,
    calculateSpeakTimeout,
};