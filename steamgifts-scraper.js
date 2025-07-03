const { chromium } = require('playwright');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const prompt = require('prompt-sync')();

// Configuration
const GROUP_URL = "https://www.steamgifts.com/group/WlYTQ/thegiveawaysclub";
const LOGIN_URL = "https://www.steamgifts.com/?login";

// Function to login
async function login(page, username, password) {
    await page.goto(LOGIN_URL);
    await page.waitForTimeout(2000);
    
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('input[name="login"]');
    await page.waitForTimeout(3000); // Wait for redirect
}

// Function to get members list
async function getMembers(page) {
    await page.goto(GROUP_URL + "/users");
    await page.waitForTimeout(2000);
    
    const members = await page.$$eval('a.table__column__heading', elements => {
        return elements.map(el => ({
            username: el.textContent.trim(),
            profile_url: "https://www.steamgifts.com" + el.getAttribute('href')
        }));
    });
    
    return members;
}

// Function to get group giveaways
async function getGroupGiveaways(page) {
    await page.goto(GROUP_URL);
    await page.waitForTimeout(2000);
    
    const giveaways = await page.$$eval('div.table__row-inner-wrap', elements => {
        return elements.map(el => {
            const titleElement = el.querySelector('a.table__column__heading');
            const creatorElement = el.querySelector('a.table__column--width-fill');
            const endDateElement = el.querySelector('div.table__column--width-small.text-center');
            const levelElement = el.querySelector('span.table__column--guest-level');
            const regionElement = el.querySelector('span.table__column--guest-region');
            
            // Find copies and entries elements
            const smallCenterElements = el.querySelectorAll('div.table__column--width-small.text-center');
            let copies = "1 copy";
            let entries = "0 entries";
            
            smallCenterElements.forEach(element => {
                const text = element.textContent.trim();
                if (text.includes("Copies")) {
                    copies = text;
                } else if (text.includes("Entries")) {
                    entries = text;
                }
            });
            
            return {
                title: titleElement ? titleElement.textContent.trim() : '',
                link: titleElement ? "https://www.steamgifts.com" + titleElement.getAttribute('href') : '',
                creator: creatorElement ? creatorElement.textContent.trim() : '',
                end_date: endDateElement ? endDateElement.textContent.trim() : '',
                level: levelElement ? levelElement.textContent.trim() : 'No level restriction',
                region: regionElement ? regionElement.textContent.trim() : 'No region restriction',
                copies: copies,
                entries: entries
            };
        });
    });
    
    return giveaways;
}

// Function to get member wins
async function getMemberWins(page, profileUrl, groupGiveawayLinks) {
    await page.goto(profileUrl + "/giveaways/won");
    await page.waitForTimeout(2000);
    
    const wins = await page.$$eval('a.table__column__heading', (elements, groupLinks) => {
        let winCount = 0;
        elements.forEach(el => {
            const winLink = "https://www.steamgifts.com" + el.getAttribute('href');
            if (groupLinks.includes(winLink)) {
                winCount++;
            }
        });
        return winCount;
    }, Array.from(groupGiveawayLinks));
    
    return wins;
}

// Function to get member comments
async function getMemberComments(page, username) {
    await page.goto(GROUP_URL + "/discussion");
    await page.waitForTimeout(2000);
    
    const commentCount = await page.$$eval('div.comment__username', (elements, targetUsername) => {
        let count = 0;
        elements.forEach(el => {
            const linkElement = el.querySelector('a');
            if (linkElement && linkElement.textContent.trim() === targetUsername) {
                count++;
            }
        });
        return count;
    }, username);
    
    return commentCount;
}

// Function to save data to CSV
async function saveToCsv(data, filename, headers) {
    const csvWriter = createCsvWriter({
        path: filename,
        header: headers.map(header => ({ id: header, title: header }))
    });
    
    await csvWriter.writeRecords(data);
    console.log(`Data saved to ${filename}`);
}

// Main function
async function main() {
    // Get credentials
    console.log("Enter your SteamGifts credentials (they won't be stored):");
    const username = prompt("Username: ");
    const password = prompt("Password: ", { echo: '*' });
    
    // Launch browser with persistent context
    const context = await chromium.launchPersistentContext('./chrome-profile', { 
        headless: false,
        timeout: 10000 * 60 * 30,
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: [
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            '--disable-web-security', // Optional: helps with some sites
            '--disable-features=VizDisplayCompositor' // Optional: helps with some rendering issues
        ]
    });
    
    try {
        const page = await context.newPage();
        
        // Login
        await login(page, username, password);
        
        // Get group giveaways
        console.log("Getting group giveaways...");
        const groupGiveaways = await getGroupGiveaways(page);
        const groupGiveawayLinks = new Set(groupGiveaways.map(g => g.link));
        
        // Get members
        console.log("Getting members...");
        const members = await getMembers(page);
        const memberStats = [];
        
        // Process each member
        for (const member of members) {
            console.log(`Processing ${member.username}...`);
            
            const created = groupGiveaways.filter(g => g.creator === member.username).length;
            const wins = await getMemberWins(page, member.profile_url, groupGiveawayLinks);
            const comments = await getMemberComments(page, member.username);
            
            memberStats.push({
                username: member.username,
                created_giveaways: created,
                won_giveaways: wins,
                comments: comments,
                played_wins: "" // Editable column for played wins
            });
            
            await page.waitForTimeout(1000); // Avoid rate limiting
        }
        
        // Save member statistics
        await saveToCsv(memberStats, "member_stats.csv", 
            ["username", "created_giveaways", "won_giveaways", "comments", "played_wins"]);
        
        // Save giveaways
        await saveToCsv(groupGiveaways, "giveaways.csv", 
            ["title", "link", "creator", "end_date", "level", "region", "copies", "entries"]);
        
        // Display results in console
        console.log("\n=== Member Statistics ===");
        memberStats.forEach(stat => {
            console.log(`User: ${stat.username}`);
            console.log(`  Created giveaways: ${stat.created_giveaways}`);
            console.log(`  Won giveaways: ${stat.won_giveaways}`);
            console.log(`  Comments: ${stat.comments}`);
            console.log(`  Played wins: ${stat.played_wins || 'Not specified'}`);
            console.log();
        });
        
        console.log("\n=== Active Giveaways ===");
        groupGiveaways.forEach(giveaway => {
            console.log(`Game: ${giveaway.title}`);
            console.log(`  Creator: ${giveaway.creator}`);
            console.log(`  End: ${giveaway.end_date}`);
            console.log(`  Level: ${giveaway.level}`);
            console.log(`  Region: ${giveaway.region}`);
            console.log(`  Copies: ${giveaway.copies}`);
            console.log(`  Participants: ${giveaway.entries}`);
            console.log();
        });
        
        console.log("Data saved to 'member_stats.csv' and 'giveaways.csv'");
        console.log("Edit 'member_stats.csv' to add 'played wins' manually.");
        
    } catch (error) {
        console.error("An error occurred:", error);
    } finally {
        await context.close();
    }
}

// Run the main function
if (require.main === module) {
    main().catch(console.error);
} 