// bot.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const dbModule = require('./db');
const {
  db,
  getUserByTelegramId,
  insertOrUpdateUser,
  insertQuest,
  getQuest,
  listQuests,
  insertRegistration,
  listRegistrationsByQuest,
  insertTeam,
  listTeamsByQuest,
  getTeamById,
  insertSubmission,
  listSubmissionsByTeam,
  getSubmission,
  updateSubmissionVerification,
  addPointsToUser,
  getUserByTelegram,
  allUsers
} = dbModule;

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean); // telegram numeric ids
if (!BOT_TOKEN) {
  console.error('Set BOT_TOKEN in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Helpers
function isAdmin(ctx) {
  const id = String(ctx.from.id);
  return ADMIN_IDS.includes(id);
}

function replyUsage(ctx, text) {
  ctx.reply(text, { parse_mode: 'Markdown' }).catch(()=>{});
}

// Start
bot.start((ctx) => {
  const name = ctx.from.first_name || 'there';
  ctx.reply(`Welcome ${name}! Use /help to see commands.`);
});

// Help
bot.command('help', (ctx) => {
  const help = `
Commands for students:
/register <student_id> <section> - register yourself
/quests - list active quests
/join <questId> - register for a quest
/myreg - show your registrations
/myteam <questId> - show your team for a quest
/submit <teamId> - send a photo or file with this caption to submit proof

Admin commands:
/createquest <id> | <title> | <min> | <max> | <points> - create a quest
/mix <questId> - run mixer and create teams
/teams <questId> - list teams
/submissions <teamId> - list submissions for a team
/verify <submissionId> - mark submission verified
/award <studentId> <points> - add points to a student
  `;
  ctx.reply(help);
});

// Register user
bot.command('register', (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const student_id = parts[0];
  const section = parts[1] || 'A';
  if (!student_id) return replyUsage(ctx, 'Usage: /register <student_id> <section>');
  const data = {
    telegram_id: String(ctx.from.id),
    student_id: student_id.trim(),
    full_name: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
    section: section.trim().toUpperCase()
  };
  try {
    insertOrUpdateUser.run(data);
    ctx.reply(`Registered as ${data.student_id} (section ${data.section}).`);
  } catch (e) {
    console.error(e);
    ctx.reply('Failed to register. Try again.');
  }
});

// Create quest (admin)
bot.command('createquest', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const raw = ctx.message.text.replace('/createquest','').trim();
  // format: id | title | min | max | points
  const parts = raw.split('|').map(s=>s.trim());
  if (parts.length < 2) return replyUsage(ctx, 'Usage: /createquest <id> | <title> | <min> | <max> | <points>');
  const id = parts[0];
  const title = parts[1];
  const min = parseInt(parts[2] || '3', 10);
  const max = parseInt(parts[3] || '5', 10);
  const points = parseInt(parts[4] || '10', 10);
  try {
    insertQuest.run(id, title, parts[1], min, max, points);
    ctx.reply(`Quest created: ${id} - ${title}`);
  } catch (e) {
    console.error(e);
    ctx.reply('Failed to create quest. Maybe id already exists.');
  }
});

// List quests
bot.command('quests', (ctx) => {
  const rows = listQuests.all();
  if (!rows.length) return ctx.reply('No quests yet.');
  const text = rows.map(r => `${r.id} — ${r.title} (min ${r.min_team_size}, max ${r.max_team_size}, reward ${r.reward_points})`).join('\n');
  ctx.reply(text);
});

// Join quest (register)
bot.command('join', (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const questId = parts[0];
  if (!questId) return replyUsage(ctx, 'Usage: /join <questId>');
  const user = getUserByTelegramId.get(String(ctx.from.id));
  if (!user) return ctx.reply('You must /register first with your student id and section.');
  const quest = getQuest.get(questId);
  if (!quest) return ctx.reply('Quest not found.');
  try {
    insertRegistration.run(questId, String(ctx.from.id), user.student_id);
    ctx.reply(`Registered for quest ${questId} as ${user.student_id}`);
  } catch (e) {
    ctx.reply('You are already registered for this quest or an error occurred.');
  }
});

// Show my registrations
bot.command('myreg', (ctx) => {
  const user = getUserByTelegramId.get(String(ctx.from.id));
  if (!user) return ctx.reply('You must /register first.');
  const rows = db.prepare('select * from registrations where telegram_id = ?').all(String(ctx.from.id));
  if (!rows.length) return ctx.reply('No registrations yet.');
  const text = rows.map(r => `${r.quest_id} — ${r.student_id} (${r.created_at})`).join('\n');
  ctx.reply(text);
});

// Mixer: create teams for a quest (admin)
bot.command('mix', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const parts = ctx.message.text.split(' ').slice(1);
  const questId = parts[0];
  if (!questId) return replyUsage(ctx, 'Usage: /mix <questId>');
  const regs = listRegistrationsByQuest.all(questId);
  if (!regs.length) return ctx.reply('No registrations for this quest.');
  // Build groups by section using users table
  const groups = {};
  regs.forEach(r => {
    const u = getUserByStudentId.get(r.student_id) || getUserByTelegram.get(r.telegram_id);
    const sec = (u && u.section) ? u.section.toUpperCase() : 'A';
    if (!groups[sec]) groups[sec] = [];
    groups[sec].push(r.student_id);
  });
  // shuffle
  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } }
  Object.values(groups).forEach(g=>shuffle(g));
  // simple greedy mixer
  const minSize = getQuest.get(questId).min_team_size || 3;
  const maxSize = getQuest.get(questId).max_team_size || 5;
  const remaining = Object.fromEntries(Object.entries(groups).map(([k,v])=>[k, v.slice()]));
  const remainingCount = ()=>Object.values(remaining).reduce((a,b)=>a+(b?b.length:0),0);
  const teams = [];
  while (remainingCount() > 0) {
    const team = new Set();
    const largest = Object.keys(remaining).sort((a,b)=> (remaining[b]||[]).length - (remaining[a]||[]).length)[0];
    if (remaining[largest] && remaining[largest].length) team.add(remaining[largest].shift());
    const secs = Object.keys(remaining);
    let idx = 0;
    while (team.size < minSize && remainingCount() > 0) {
      const s = secs[idx % secs.length];
      if (remaining[s] && remaining[s].length) team.add(remaining[s].shift());
      idx++; if (idx > 1000) break;
    }
    teams.push(Array.from(team));
  }
  // merge small teams
  const final = [];
  for (const t of teams) {
    if (t.length >= minSize) final.push(t);
    else {
      let placed = false;
      for (const ft of final) {
        if (ft.length + t.length <= maxSize) { ft.push(...t); placed = true; break; }
      }
      if (!placed) final.push(t);
    }
  }
  // insert teams
  let created = 0;
  final.forEach(arr => {
    const id = uuidv4();
    try {
      insertTeam.run(id, questId, JSON.stringify(arr));
      created++;
    } catch (e) {
      console.error(e);
    }
  });
  ctx.reply(`Mixer finished. Created ${created} teams for quest ${questId}.`);
});

// List teams for a quest
bot.command('teams', (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const questId = parts[0];
  if (!questId) return replyUsage(ctx, 'Usage: /teams <questId>');
  const rows = listTeamsByQuest.all(questId);
  if (!rows.length) return ctx.reply('No teams yet.');
  const text = rows.map(r => {
    const members = JSON.parse(r.member_student_ids || '[]');
    return `${r.id.slice(0,8)} — ${members.join(', ')}`;
  }).join('\n\n');
  ctx.reply(text);
});

// Show my team for a quest
bot.command('myteam', (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const questId = parts[0];
  if (!questId) return replyUsage(ctx, 'Usage: /myteam <questId>');
  const user = getUserByTelegramId.get(String(ctx.from.id));
  if (!user) return ctx.reply('You must /register first.');
  const teams = listTeamsByQuest.all(questId);
  for (const t of teams) {
    const members = JSON.parse(t.member_student_ids || '[]');
    if (members.includes(user.student_id)) {
      return ctx.reply(`Your team: ${t.id}\nMembers: ${members.join(', ')}`);
    }
  }
  ctx.reply('You are not in any team for this quest.');
});

// Submit proof: user sends file/photo with caption "/submit <teamId>" or reply to /submit command
bot.command('submit', (ctx) => {
  const parts = ctx.message.text.split(' ').slice(1);
  const teamId = parts[0];
  if (!teamId) return replyUsage(ctx, 'Usage: /submit <teamId> then send a photo or file as reply to this command or send /submit <teamId> as caption with the file.');
  ctx.reply('Now send the photo or file as a reply to this message or send it with this caption. The bot will record it.');
});

// Handle incoming photos and documents
bot.on(['photo','document'], async (ctx) => {
  // try to extract teamId from caption or replied message
  let teamId = null;
  let caption = ctx.message.caption || '';
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.text) {
    const m = ctx.message.reply_to_message.text.trim();
    const parts = m.split(' ');
    if (parts[0] === '/submit' && parts[1]) teamId = parts[1];
  }
  // also check caption for "/submit <teamId>"
  const capParts = caption.split(' ').filter(Boolean);
  if (!teamId && capParts[0] === '/submit' && capParts[1]) teamId = capParts[1];
  if (!teamId) return ctx.reply('No team id found. Use /submit <teamId> then send the file as reply or include /submit <teamId> in the caption.');

  const file_id = ctx.message.photo ? ctx.message.photo.slice(-1)[0].file_id : (ctx.message.document && ctx.message.document.file_id);
  const submitId = uuidv4();
  try {
    insertSubmission.run(submitId, teamId, String(ctx.from.id), file_id, caption || '');
    ctx.reply(`Submission received. ID: ${submitId}. Awaiting verification.`);
  } catch (e) {
    console.error(e);
    ctx.reply('Failed to record submission.');
  }
});

// List submissions for a team (admin)
bot.command('submissions', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const parts = ctx.message.text.split(' ').slice(1);
  const teamId = parts[0];
  if (!teamId) return replyUsage(ctx, 'Usage: /submissions <teamId>');
  const rows = listSubmissionsByTeam.all(teamId);
  if (!rows.length) return ctx.reply('No submissions for this team.');
  const text = rows.map(r => `${r.id} — by ${r.submitted_by} — ${r.verification_status}`).join('\n');
  ctx.reply(text);
});

// Verify submission (admin)
bot.command('verify', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const parts = ctx.message.text.split(' ').slice(1);
  const submissionId = parts[0];
  if (!submissionId) return replyUsage(ctx, 'Usage: /verify <submissionId>');
  const sub = getSubmission.get(submissionId);
  if (!sub) return ctx.reply('Submission not found.');
  updateSubmissionVerification.run('verified', String(ctx.from.id), submissionId);
  // award points to team members
  const team = getTeamById.get(sub.team_id);
  if (team) {
    const members = JSON.parse(team.member_student_ids || '[]');
    const quest = getQuest.get(team.quest_id);
    const points = quest ? quest.reward_points : 10;
    members.forEach(sid => {
      addPointsToUser.run(points, sid);
    });
  }
  ctx.reply(`Submission ${submissionId} verified and points awarded.`);
});

// Award points manually (admin)
bot.command('award', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Admin only.');
  const parts = ctx.message.text.split(' ').slice(1);
  const studentId = parts[0];
  const pts = parseInt(parts[1] || '0', 10);
  if (!studentId || !pts) return replyUsage(ctx, 'Usage: /award <studentId> <points>');
  addPointsToUser.run(pts, studentId);
  ctx.reply(`Awarded ${pts} points to ${studentId}.`);
});

// Show leaderboard
bot.command('leaderboard', (ctx) => {
  const rows = allUsers.all().sort((a,b)=> (b.points||0) - (a.points||0)).slice(0,20);
  if (!rows.length) return ctx.reply('No users yet.');
  const text = rows.map(r => `${r.student_id || r.full_name} — ${r.points || 0} pts`).join('\n');
  ctx.reply(text);
});

// Fallback
bot.on('message', (ctx) => {
  // ignore if handled above
  // provide short guidance
  if (ctx.message.text && ctx.message.text.startsWith('/')) return;
  ctx.reply('I did not understand. Use /help to see commands.');
});

// Launch
bot.launch().then(()=> console.log('Bot started')).catch(console.error);

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));