// Fuzzy search, ported from copyclip (https://github.com/alichherawalla/copyclip, MIT).
// Pure TS, reused unchanged except the types import path.

import type { ClipboardItemDisplay, SearchResult } from './types'

/**
 * Fuzzy search implementation ported from Swift version.
 * Uses a scoring algorithm that rewards:
 * - Consecutive matches
 * - Matches at word boundaries
 * - Matches at the start of the string
 */

interface FuzzyMatchResult {
  score: number
  matches: Array<[number, number]>
}

export function fuzzyMatch(pattern: string, text: string): FuzzyMatchResult | null {
  if (!pattern || !text) {
    return null
  }

  const patternLower = pattern.toLowerCase()
  const textLower = text.toLowerCase()

  // Quick check: all pattern characters must exist in text
  let patternIndex = 0
  for (let i = 0; i < textLower.length && patternIndex < patternLower.length; i++) {
    if (textLower[i] === patternLower[patternIndex]) {
      patternIndex++
    }
  }

  if (patternIndex !== patternLower.length) {
    return null // Not all characters found
  }

  // Find best match with scoring
  const result = findBestMatch(patternLower, textLower)
  if (!result) {
    return null
  }

  return result
}

function findBestMatch(pattern: string, text: string): FuzzyMatchResult | null {
  const matches: number[] = []
  let score = 0
  let patternIdx = 0
  let consecutiveBonus = 0

  for (let textIdx = 0; textIdx < text.length && patternIdx < pattern.length; textIdx++) {
    if (text[textIdx] === pattern[patternIdx]) {
      matches.push(textIdx)

      // Base score for match
      let matchScore = 1

      // Bonus for consecutive matches
      if (matches.length > 1 && matches[matches.length - 1] === matches[matches.length - 2] + 1) {
        consecutiveBonus++
        matchScore += consecutiveBonus * 2
      } else {
        consecutiveBonus = 0
      }

      // Bonus for word boundary (start of word)
      if (textIdx === 0 || isWordBoundary(text[textIdx - 1])) {
        matchScore += 5
      }

      // Bonus for camelCase boundary
      if (textIdx > 0 && isUpperCase(text[textIdx]) && isLowerCase(text[textIdx - 1])) {
        matchScore += 3
      }

      // Bonus for matching at start
      if (textIdx === 0) {
        matchScore += 10
      }

      score += matchScore
      patternIdx++
    }
  }

  if (patternIdx !== pattern.length) {
    return null
  }

  // Penalty for unmatched characters (to prefer shorter matches)
  const unmatchedPenalty = (text.length - matches.length) * 0.1
  score = Math.max(0, score - unmatchedPenalty)

  // Normalize score
  score = score / pattern.length

  // Convert match indices to ranges
  const ranges = indicesToRanges(matches)

  return { score, matches: ranges }
}

function isWordBoundary(char: string): boolean {
  return /[\s\-_.,;:!?()[\]{}'"/\\]/.test(char)
}

function isUpperCase(char: string): boolean {
  return char >= 'A' && char <= 'Z'
}

function isLowerCase(char: string): boolean {
  return char >= 'a' && char <= 'z'
}

function indicesToRanges(indices: number[]): Array<[number, number]> {
  if (indices.length === 0) {
    return []
  }

  const ranges: Array<[number, number]> = []
  let start = indices[0]
  let end = indices[0]

  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === end + 1) {
      end = indices[i]
    } else {
      ranges.push([start, end + 1])
      start = indices[i]
      end = indices[i]
    }
  }

  ranges.push([start, end + 1])
  return ranges
}

function wordMatchBonus(query: string, text: string): number {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
  if (queryWords.length === 0) return 0

  const textLower = text.toLowerCase()
  let bonus = 0

  for (const word of queryWords) {
    // Exact word match (bounded by word boundaries or string edges)
    const wordRegex = new RegExp(
      `(?:^|[\\s\\-_.,;:!?()\\[\\]{}'"\\/\\\\])${escapeRegex(word)}(?:$|[\\s\\-_.,;:!?()\\[\\]{}'"\\/\\\\])`,
      'i'
    )
    if (wordRegex.test(text)) {
      bonus += 50
    } else if (textLower.includes(word)) {
      // Substring match (e.g. "kubectl" inside "run_kubectl_apply")
      bonus += 30
    }
  }

  // Extra bonus when all query words are found as words
  const allWordsFound = queryWords.every((word) => textLower.includes(word))
  if (allWordsFound) {
    bonus += 20
  }

  return bonus
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function fuzzySearch(items: ClipboardItemDisplay[], query: string): SearchResult[] {
  const results: SearchResult[] = []

  for (const item of items) {
    const text = item.textContent || item.preview
    const matchResult = fuzzyMatch(query, text)

    if (matchResult) {
      const bonus = wordMatchBonus(query, text)
      results.push({
        item,
        score: matchResult.score + bonus,
        matches: matchResult.matches
      })
    }
  }

  // Sort by match score (best first), then recency as tiebreaker
  results.sort((a, b) => b.score - a.score || b.item.timestamp - a.item.timestamp)

  // Return top 100 results
  return results.slice(0, 100)
}
