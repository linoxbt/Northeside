/**
 * $NSD player rewards are live (NEXT_PUBLIC_NSD_REWARDS_LIVE=1, set together with the worker's
 * NSD_REWARDS_ENABLED=1). Copy that mentions rewards follows this one flag, so switching rewards
 * off also takes every mention of them out of the app (CLAUDE.md: no reward promises unless live).
 */
export const nsdRewardsLive = process.env.NEXT_PUBLIC_NSD_REWARDS_LIVE === "1";

/** One plain sentence used wherever the app states what players can win. */
export const NSD_REWARDS_LINE =
  "No cash prizes. Verified players near the top of a matchweek or the season can earn $NSD tokens, shared by a published formula.";
