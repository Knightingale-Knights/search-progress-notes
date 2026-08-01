const BUBBLE_BASE_URL = process.env.BUBBLE_BASE_URL; // e.g. https://knightingale.com.au
const BUBBLE_API_TOKEN = process.env.BUBBLE_API_TOKEN;

// Fetches every object of a given type from Bubble's Data API, paging through
// the cursor until nothing remains. Fine for backfill-sized volumes; for very
// large tables, pass constraints to narrow the set first.
async function fetchAllBubbleObjects(typeName, { constraints, sortField, descending, pageSize = 100 } = {}) {
  const results = [];
  let cursor = 0;

  while (true) {
    const params = new URLSearchParams();
    params.set('api_token', BUBBLE_API_TOKEN);
    params.set('cursor', String(cursor));
    params.set('limit', String(pageSize));
    if (constraints) params.set('constraints', JSON.stringify(constraints));
    if (sortField) {
      params.set('sort_field', sortField);
      params.set('descending', descending ? 'true' : 'false');
    }

    const url = `${BUBBLE_BASE_URL}/api/1.1/obj/${encodeURIComponent(typeName)}?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bubble API error (${res.status}) fetching ${typeName}: ${text}`);
    }

    const json = await res.json();
    const { results: pageResults, remaining } = json.response;
    results.push(...pageResults);

    if (!remaining || remaining <= 0 || pageResults.length === 0) break;
    cursor += pageResults.length;
  }

  return results;
}

// Builds a { userId: firstName } map for a given list of user ids, by pulling
// the full User table once and filtering. Cheaper than one API call per id
// for anything but a handful of lookups.
async function buildUserFirstNameMap(userIds) {
  const idSet = new Set(userIds.filter(Boolean));
  const map = {};

  if (idSet.size === 0) return map;

  const users = await fetchAllBubbleObjects('User');

  for (const user of users) {
    if (idSet.has(user._id)) {
      map[user._id] = user['First Name'] || null;
    }
  }

  return map;
}

module.exports = { fetchAllBubbleObjects, buildUserFirstNameMap };
