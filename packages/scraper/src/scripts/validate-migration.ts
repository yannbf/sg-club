import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../../../packages/website/public/data");
const BACKUP_DIR = path.join(DATA_DIR, "backup-2026-04-04T07-24-37-506Z");

function loadJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

// Verify paths exist
for (const dir of [DATA_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
}

const backupGroupUsers = loadJson(path.join(BACKUP_DIR, "group_users.json"));
const migratedGroupUsers = loadJson(path.join(DATA_DIR, "group_users.json"));
const backupGiveaways = loadJson(path.join(BACKUP_DIR, "giveaways.json"));
const migratedGiveaways = loadJson(path.join(DATA_DIR, "giveaways.json"));
const backupEntries = loadJson(path.join(BACKUP_DIR, "user_entries.json"));
const migratedEntries = loadJson(path.join(DATA_DIR, "user_entries.json"));
const backupExMembers = loadJson(path.join(BACKUP_DIR, "ex_members.json"));
const migratedExMembers = loadJson(path.join(DATA_DIR, "ex_members.json"));
const steamIdMap = loadJson(path.join(DATA_DIR, "steam_id_map.json"));

// Build reverse map: username -> steam_id (current names take priority)
const usernameToSteamId: Record<string, string> = {};
for (const [steamId, info] of Object.entries(steamIdMap) as [string, any][]) {
  usernameToSteamId[info.current] = steamId;
}
// Then add previous names (only if not already mapped)
for (const [steamId, info] of Object.entries(steamIdMap) as [string, any][]) {
  for (const prev of info.previous || []) {
    if (!usernameToSteamId[prev]) {
      usernameToSteamId[prev] = steamId;
    }
  }
}

let totalErrors = 0;
let totalWarnings = 0;

function error(msg: string) {
  console.log(`  [ERROR] ${msg}`);
  totalErrors++;
}

function warn(msg: string) {
  console.log(`  [WARN] ${msg}`);
  totalWarnings++;
}

// ============================================================
// 1. group_users.json
// ============================================================
console.log("\n========================================");
console.log("1. VALIDATING group_users.json");
console.log("========================================");

const backupUsers = backupGroupUsers.users as Record<string, any>;
const migratedUsers = migratedGroupUsers.users as Record<string, any>;

const backupUsernames = Object.keys(backupUsers);
const migratedSteamIds = Object.keys(migratedUsers);

console.log(`  Backup users (keyed by username): ${backupUsernames.length}`);
console.log(`  Migrated users (keyed by steam_id): ${migratedSteamIds.length}`);

if (backupUsernames.length !== migratedSteamIds.length) {
  error(`User count mismatch: backup=${backupUsernames.length} migrated=${migratedSteamIds.length}`);
}

let usersMatched = 0;
let usersMissing = 0;
let usersStatsMismatch = 0;

for (const username of backupUsernames) {
  const backupUser = backupUsers[username];
  const steamId = backupUser.steam_id;

  if (!steamId) {
    error(`Backup user "${username}" has no steam_id`);
    continue;
  }

  const migratedUser = migratedUsers[steamId];
  if (!migratedUser) {
    error(`User "${username}" (steam_id=${steamId}) not found in migrated data`);
    usersMissing++;
    continue;
  }

  // Check username preserved
  if (migratedUser.username !== username) {
    error(`User steam_id=${steamId}: username mismatch: backup="${username}" migrated="${migratedUser.username}"`);
  }

  // Deep compare stats
  let statsMatch = true;
  const backupStats = backupUser.stats;
  const migratedStats = migratedUser.stats;
  if (backupStats && migratedStats) {
    for (const key of Object.keys(backupStats)) {
      if (JSON.stringify(backupStats[key]) !== JSON.stringify(migratedStats[key])) {
        error(`User "${username}" stat "${key}": backup=${JSON.stringify(backupStats[key])} migrated=${JSON.stringify(migratedStats[key])}`);
        statsMatch = false;
      }
    }
  }

  // Check key fields
  for (const field of ["profile_url", "avatar_url", "steam_profile_url", "country_code", "steam_profile_is_private"]) {
    if (JSON.stringify(backupUser[field]) !== JSON.stringify(migratedUser[field])) {
      error(`User "${username}" field "${field}": backup=${JSON.stringify(backupUser[field])} migrated=${JSON.stringify(migratedUser[field])}`);
      statsMatch = false;
    }
  }

  // Check giveaways_won count
  const backupWonCount = (backupUser.giveaways_won || []).length;
  const migratedWonCount = (migratedUser.giveaways_won || []).length;
  if (backupWonCount !== migratedWonCount) {
    error(`User "${username}" giveaways_won count: backup=${backupWonCount} migrated=${migratedWonCount}`);
    statsMatch = false;
  }

  if (statsMatch) usersMatched++;
  else usersStatsMismatch++;
}

// Check for duplicates: multiple steam_ids mapping to same username
const seenUsernames = new Map<string, string>();
for (const [steamId, user] of Object.entries(migratedUsers) as [string, any][]) {
  const un = user.username;
  if (seenUsernames.has(un)) {
    error(`Duplicate username "${un}" found at steam_ids: ${seenUsernames.get(un)} and ${steamId}`);
  }
  seenUsernames.set(un, steamId);
}

console.log(`  Result: ${usersMatched} matched, ${usersMissing} missing, ${usersStatsMismatch} with mismatches`);

// ============================================================
// 2. giveaways.json
// ============================================================
console.log("\n========================================");
console.log("2. VALIDATING giveaways.json");
console.log("========================================");

const backupGAs = backupGiveaways.giveaways as any[];
const migratedGAs = migratedGiveaways.giveaways as any[];

console.log(`  Backup giveaways: ${backupGAs.length}`);
console.log(`  Migrated giveaways: ${migratedGAs.length}`);

if (backupGAs.length !== migratedGAs.length) {
  error(`Giveaway count mismatch: backup=${backupGAs.length} migrated=${migratedGAs.length}`);
}

const migratedGAMap = new Map<string, any>();
for (const g of migratedGAs) {
  migratedGAMap.set(g.id, g);
}

let gaMissing = 0;
let gaCreatorOk = 0;
let gaCreatorIssues = 0;
let gaCreatorUnresolvable = 0;
let gaWinnerOk = 0;
let gaWinnerIssues = 0;
let gaWinnersChecked = 0;
let gaWinnerUnresolvable = 0;

for (const bg of backupGAs) {
  const mg = migratedGAMap.get(bg.id);
  if (!mg) {
    error(`Giveaway "${bg.id}" (${bg.name}) not found in migrated data`);
    gaMissing++;
    continue;
  }

  // Verify creator_username matches original creator
  if (mg.creator_username !== bg.creator) {
    error(`Giveaway "${bg.id}": creator_username="${mg.creator_username}" should be "${bg.creator}"`);
    gaCreatorIssues++;
  } else {
    // Verify creator is a steam_id or fallback to username
    const expectedSteamId = usernameToSteamId[bg.creator];
    if (expectedSteamId) {
      if (mg.creator !== expectedSteamId) {
        error(`Giveaway "${bg.id}": creator="${mg.creator}" should be steam_id="${expectedSteamId}" for "${bg.creator}"`);
        gaCreatorIssues++;
      } else {
        gaCreatorOk++;
      }
    } else {
      // Unresolvable -- creator should remain as username
      if (mg.creator === bg.creator) {
        gaCreatorUnresolvable++;
        gaCreatorOk++;
      } else {
        warn(`Giveaway "${bg.id}": creator="${mg.creator}" -- unresolvable username "${bg.creator}" was changed`);
        gaCreatorIssues++;
      }
    }
  }

  // Verify winners
  const backupWinners = bg.winners || [];
  const migratedWinners = mg.winners || [];

  if (backupWinners.length !== migratedWinners.length) {
    error(`Giveaway "${bg.id}": winners count mismatch: backup=${backupWinners.length} migrated=${migratedWinners.length}`);
  }

  for (let i = 0; i < backupWinners.length; i++) {
    const bw = backupWinners[i];
    const mw = migratedWinners[i];
    if (!mw) continue;

    gaWinnersChecked++;

    if (bw.name === null) {
      // Null winner name -- should stay null in some form
      continue;
    }

    // winner_username should match original name
    if (mw.winner_username !== bw.name) {
      error(`Giveaway "${bg.id}" winner[${i}]: winner_username="${mw.winner_username}" should be "${bw.name}"`);
      gaWinnerIssues++;
      continue;
    }

    // name should be resolved to steam_id (or stay as username if unresolvable)
    const expectedWinnerSteamId = usernameToSteamId[bw.name];
    if (expectedWinnerSteamId) {
      if (mw.name !== expectedWinnerSteamId) {
        error(`Giveaway "${bg.id}" winner[${i}]: name="${mw.name}" should be steam_id="${expectedWinnerSteamId}" for "${bw.name}"`);
        gaWinnerIssues++;
      } else {
        gaWinnerOk++;
      }
    } else {
      if (mw.name === bw.name) {
        gaWinnerUnresolvable++;
        gaWinnerOk++;
      } else {
        warn(`Giveaway "${bg.id}" winner[${i}]: name="${mw.name}" -- unresolvable "${bw.name}" was changed`);
        gaWinnerIssues++;
      }
    }
  }

  // Verify other fields unchanged
  for (const field of ["name", "points", "copies", "app_id", "link", "created_timestamp", "end_timestamp", "entry_count", "cv_status", "is_shared"]) {
    if (JSON.stringify(bg[field]) !== JSON.stringify(mg[field])) {
      error(`Giveaway "${bg.id}" field "${field}": backup=${JSON.stringify(bg[field])} migrated=${JSON.stringify(mg[field])}`);
    }
  }
}

console.log(`  Missing giveaways: ${gaMissing}`);
console.log(`  Creators -- OK: ${gaCreatorOk} (${gaCreatorUnresolvable} unresolvable kept as username), Issues: ${gaCreatorIssues}`);
console.log(`  Winners -- Checked: ${gaWinnersChecked}, OK: ${gaWinnerOk} (${gaWinnerUnresolvable} unresolvable kept as username), Issues: ${gaWinnerIssues}`);

// ============================================================
// 3. user_entries.json
// ============================================================
console.log("\n========================================");
console.log("3. VALIDATING user_entries.json");
console.log("========================================");

const backupEntryKeys = Object.keys(backupEntries);
const migratedEntryKeys = Object.keys(migratedEntries);

console.log(`  Backup giveaway entry groups: ${backupEntryKeys.length}`);
console.log(`  Migrated giveaway entry groups: ${migratedEntryKeys.length}`);

if (backupEntryKeys.length !== migratedEntryKeys.length) {
  error(`Entry group count mismatch: backup=${backupEntryKeys.length} migrated=${migratedEntryKeys.length}`);
}

let totalBackupEntries = 0;
let totalMigratedEntries = 0;
let entryCountMismatches = 0;
let entriesWithUsernameField = 0;
let entrySteamIdResolutionErrors = 0;
let entrySteamIdMissing = 0;
let entriesChecked = 0;
let entriesResolvedOk = 0;

for (const giveawayKey of backupEntryKeys) {
  const backupList = backupEntries[giveawayKey] as any[];
  const migratedList = migratedEntries[giveawayKey] as any[];

  totalBackupEntries += backupList.length;

  if (!migratedList) {
    error(`Entry group "${giveawayKey}" not found in migrated data`);
    continue;
  }

  totalMigratedEntries += migratedList.length;

  if (backupList.length !== migratedList.length) {
    error(`Entry group "${giveawayKey}": count mismatch: backup=${backupList.length} migrated=${migratedList.length}`);
    entryCountMismatches++;
  }

  // Build a set of backup entries by username+joined_at for matching
  const backupSet = new Set<string>();
  for (const entry of backupList) {
    backupSet.add(entry.username + "|" + entry.joined_at);
  }

  for (const mEntry of migratedList) {
    entriesChecked++;

    // Check username field is NOT present
    if ("username" in mEntry) {
      entriesWithUsernameField++;
    }

    // Check steam_id is present
    if (!mEntry.steam_id) {
      entrySteamIdMissing++;
      if (entrySteamIdMissing <= 5) {
        error(`Entry in "${giveawayKey}": missing steam_id`);
      }
      continue;
    }

    // Cross-reference: steam_id -> username via map
    const mapEntry = steamIdMap[mEntry.steam_id];
    if (!mapEntry) {
      // Not in steam_id_map -- might be ok if it's a non-member
      continue;
    }

    // Find matching backup entry by trying all known usernames for this steam_id
    const possibleUsernames = [mapEntry.current, ...(mapEntry.previous || [])];
    let found = false;
    for (const un of possibleUsernames) {
      if (backupSet.has(un + "|" + mEntry.joined_at)) {
        found = true;
        break;
      }
    }
    if (found) {
      entriesResolvedOk++;
    } else {
      entrySteamIdResolutionErrors++;
      if (entrySteamIdResolutionErrors <= 10) {
        error(`Entry in "${giveawayKey}": steam_id="${mEntry.steam_id}" (usernames: ${possibleUsernames.join(", ")}) joined_at=${mEntry.joined_at} has no matching backup entry`);
      }
    }
  }
}

// Count migrated entries for keys not in backup
for (const giveawayKey of migratedEntryKeys) {
  if (!backupEntries[giveawayKey]) {
    const extra = migratedEntries[giveawayKey].length;
    totalMigratedEntries += extra;
    if (extra > 0) {
      warn(`Entry group "${giveawayKey}" exists in migrated (${extra} entries) but not backup`);
    }
  }
}

console.log(`  Total backup entries: ${totalBackupEntries}`);
console.log(`  Total migrated entries: ${totalMigratedEntries}`);
console.log(`  Entry group count mismatches: ${entryCountMismatches}`);
console.log(`  Entries with 'username' field still present: ${entriesWithUsernameField}`);
console.log(`  Entries checked: ${entriesChecked}`);
console.log(`  Entries resolved OK via steam_id_map: ${entriesResolvedOk}`);
console.log(`  Steam ID resolution errors: ${entrySteamIdResolutionErrors}${entrySteamIdResolutionErrors > 10 ? " (showing first 10)" : ""}`);
console.log(`  Entries missing steam_id: ${entrySteamIdMissing}`);

// ============================================================
// 4. ex_members.json
// ============================================================
console.log("\n========================================");
console.log("4. VALIDATING ex_members.json");
console.log("========================================");

const backupExUsers = backupExMembers.users as any[];
const migratedExUsers = migratedExMembers.users as Record<string, any>;

const isBackupArray = Array.isArray(backupExUsers);
const isMigratedRecord = !Array.isArray(migratedExUsers) && typeof migratedExUsers === "object";

console.log(`  Backup ex_members type: ${isBackupArray ? "array" : typeof backupExUsers} (${isBackupArray ? backupExUsers.length : "N/A"} items)`);
console.log(`  Migrated ex_members type: ${isMigratedRecord ? "record" : typeof migratedExUsers} (${isMigratedRecord ? Object.keys(migratedExUsers).length : "N/A"} items)`);

if (!isBackupArray) {
  warn("Backup ex_members.users is not an array -- structure may differ from expected");
}
if (!isMigratedRecord) {
  error("Migrated ex_members.users should be a Record<steam_id, User>");
}

if (isBackupArray && isMigratedRecord) {
  if (backupExUsers.length !== Object.keys(migratedExUsers).length) {
    error(`Ex-members count mismatch: backup=${backupExUsers.length} migrated=${Object.keys(migratedExUsers).length}`);
  }

  let exMatched = 0;
  let exMissing = 0;
  let exMismatched = 0;

  for (const backupEx of backupExUsers) {
    const steamId = backupEx.steam_id;
    if (!steamId) {
      error(`Backup ex-member "${backupEx.username}" has no steam_id`);
      continue;
    }

    const migratedEx = migratedExUsers[steamId];
    if (!migratedEx) {
      error(`Ex-member "${backupEx.username}" (steam_id=${steamId}) not found in migrated record`);
      exMissing++;
      continue;
    }

    if (migratedEx.username !== backupEx.username) {
      error(`Ex-member steam_id=${steamId}: username mismatch: backup="${backupEx.username}" migrated="${migratedEx.username}"`);
    }

    // Compare stats
    let match = true;
    const bs = backupEx.stats;
    const ms = migratedEx.stats;
    if (bs && ms) {
      for (const key of Object.keys(bs)) {
        if (JSON.stringify(bs[key]) !== JSON.stringify(ms[key])) {
          error(`Ex-member "${backupEx.username}" stat "${key}": backup=${JSON.stringify(bs[key])} migrated=${JSON.stringify(ms[key])}`);
          match = false;
        }
      }
    }

    for (const field of ["profile_url", "avatar_url", "steam_profile_url", "country_code"]) {
      if (JSON.stringify(backupEx[field]) !== JSON.stringify(migratedEx[field])) {
        error(`Ex-member "${backupEx.username}" field "${field}" mismatch`);
        match = false;
      }
    }

    // Check giveaways_won count
    const bwc = (backupEx.giveaways_won || []).length;
    const mwc = (migratedEx.giveaways_won || []).length;
    if (bwc !== mwc) {
      error(`Ex-member "${backupEx.username}" giveaways_won count: backup=${bwc} migrated=${mwc}`);
      match = false;
    }

    if (match) exMatched++;
    else exMismatched++;
  }

  console.log(`  Result: ${exMatched} matched, ${exMissing} missing, ${exMismatched} with mismatches`);
}

// ============================================================
// 5. steam_id_map.json: Check for steam_id collisions
// ============================================================
console.log("\n========================================");
console.log("5. CHECKING steam_id_map.json for collisions");
console.log("========================================");

// Collect all usernames from original data
const allOriginalUsernames = new Set<string>();

for (const un of Object.keys(backupUsers)) {
  allOriginalUsernames.add(un);
}
if (isBackupArray) {
  for (const ex of backupExUsers) {
    if (ex.username) allOriginalUsernames.add(ex.username);
  }
}
for (const g of backupGAs) {
  if (g.creator) allOriginalUsernames.add(g.creator);
  for (const w of g.winners || []) {
    if (w.name) allOriginalUsernames.add(w.name);
  }
}

console.log(`  Total unique usernames across all original data: ${allOriginalUsernames.size}`);
console.log(`  Steam ID map entries: ${Object.keys(steamIdMap).length}`);

// Group original-data usernames by resolved steam_id
const steamIdGroups = new Map<string, string[]>();
for (const un of allOriginalUsernames) {
  const sid = usernameToSteamId[un];
  if (!sid) continue;
  if (!steamIdGroups.has(sid)) steamIdGroups.set(sid, []);
  steamIdGroups.get(sid)!.push(un);
}

let collisions = 0;
for (const [sid, usernames] of steamIdGroups) {
  if (usernames.length > 1) {
    // Check if this is already tracked in the map's "previous" field
    const mapEntry = steamIdMap[sid];
    const tracked = new Set([mapEntry.current, ...(mapEntry.previous || [])]);
    const allTracked = usernames.every((un) => tracked.has(un));
    console.log(`  [COLLISION] steam_id=${sid} -> usernames: [${usernames.join(", ")}]${allTracked ? " (all tracked in map)" : " *** NOT fully tracked ***"}`);
    collisions++;
  }
}

// Also check: any usernames in original data that have NO steam_id mapping
let unmapped = 0;
const unmappedList: string[] = [];
for (const un of allOriginalUsernames) {
  if (!usernameToSteamId[un]) {
    unmapped++;
    if (unmappedList.length < 20) unmappedList.push(un);
  }
}

if (collisions === 0) {
  console.log("  No steam_id collisions found.");
} else {
  console.log(`  Total collisions (multiple usernames -> same steam_id): ${collisions}`);
}

console.log(`  Usernames with no steam_id mapping: ${unmapped}`);
if (unmappedList.length > 0) {
  console.log(`  First ${unmappedList.length}: ${unmappedList.join(", ")}`);
}

// ============================================================
// 6. Check for cross-source username collisions
// ============================================================
console.log("\n========================================");
console.log("6. CHECKING for cross-source username collisions");
console.log("========================================");

const creatorUsernames = new Set<string>();
for (const g of backupGAs) {
  if (g.creator) creatorUsernames.add(g.creator);
}

const previousNameToCurrentUser = new Map<string, string>();
for (const [steamId, info] of Object.entries(steamIdMap) as [string, any][]) {
  for (const prev of info.previous || []) {
    previousNameToCurrentUser.set(prev, `${info.current} (${steamId})`);
  }
}

let crossCollisions = 0;

// Check: creator username is also someone's previous name
for (const creator of creatorUsernames) {
  if (previousNameToCurrentUser.has(creator)) {
    console.log(`  [CROSS] Creator username "${creator}" is also a previous name of ${previousNameToCurrentUser.get(creator)}`);
    crossCollisions++;
  }
}

// Check: group_users username is someone else's previous name
for (const un of Object.keys(backupUsers)) {
  if (previousNameToCurrentUser.has(un)) {
    const resolvedSteamId = usernameToSteamId[un];
    const backupSteamId = backupUsers[un]?.steam_id;
    // Only flag if it maps to a DIFFERENT user
    if (resolvedSteamId && backupSteamId && resolvedSteamId !== backupSteamId) {
      console.log(`  [CROSS] Group user "${un}" (steam_id=${backupSteamId}) shares username with previous name of ${previousNameToCurrentUser.get(un)}`);
      crossCollisions++;
    }
  }
}

if (crossCollisions === 0) {
  console.log("  No cross-source username collisions found.");
} else {
  console.log(`  Total cross-source collisions: ${crossCollisions}`);
}

// ============================================================
// SUMMARY
// ============================================================
console.log("\n========================================");
console.log("SUMMARY");
console.log("========================================");
console.log(`  Total errors: ${totalErrors}`);
console.log(`  Total warnings: ${totalWarnings}`);
if (totalErrors === 0 && totalWarnings === 0) {
  console.log("\n  MIGRATION VALIDATION PASSED -- no issues found.");
} else if (totalErrors === 0) {
  console.log("\n  MIGRATION VALIDATION PASSED with warnings.");
} else {
  console.log("\n  MIGRATION VALIDATION HAS ISSUES -- review errors above.");
}
