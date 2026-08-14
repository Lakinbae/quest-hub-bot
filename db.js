// db.js
const Database = require('better-sqlite3');
const db = new Database('aastu-quest.db');

// Create tables if not exist
db.exec(`
PRAGMA foreign_keys = ON;

create table if not exists users (
  id integer primary key autoincrement,
  telegram_id text unique,
  student_id text,
  full_name text,
  section text,
  points integer default 0,
  created_at datetime default current_timestamp
);

create table if not exists quests (
  id text primary key,
  title text,
  description text,
  min_team_size integer default 3,
  max_team_size integer default 5,
  reward_points integer default 10,
  created_at datetime default current_timestamp
);

create table if not exists registrations (
  id integer primary key autoincrement,
  quest_id text,
  telegram_id text,
  student_id text,
  created_at datetime default current_timestamp,
  unique(quest_id, student_id),
  foreign key (quest_id) references quests(id) on delete cascade
);

create table if not exists teams (
  id text primary key,
  quest_id text,
  member_student_ids text, -- JSON array
  status text default 'active',
  created_at datetime default current_timestamp,
  foreign key (quest_id) references quests(id) on delete cascade
);

create table if not exists submissions (
  id text primary key,
  team_id text,
  submitted_by text,
  file_id text,
  caption text,
  verification_status text default 'pending',
  verified_by text,
  verified_at datetime,
  created_at datetime default current_timestamp,
  foreign key (team_id) references teams(id) on delete cascade
);
`);

// Prepared statements
module.exports = {
  db,
  getUserByTelegramId: db.prepare('select * from users where telegram_id = ?'),
  getUserByStudentId: db.prepare('select * from users where student_id = ?'),
  insertOrUpdateUser: db.prepare(`
    insert into users (telegram_id, student_id, full_name, section)
    values (@telegram_id, @student_id, @full_name, @section)
    on conflict(telegram_id) do update set student_id = excluded.student_id, full_name = excluded.full_name, section = excluded.section
  `),
  insertQuest: db.prepare('insert into quests (id, title, description, min_team_size, max_team_size, reward_points) values (?, ?, ?, ?, ?, ?)'),
  getQuest: db.prepare('select * from quests where id = ?'),
  listQuests: db.prepare('select * from quests order by created_at desc'),
  insertRegistration: db.prepare('insert into registrations (quest_id, telegram_id, student_id) values (?, ?, ?)'),
  listRegistrationsByQuest: db.prepare('select * from registrations where quest_id = ?'),
  insertTeam: db.prepare('insert into teams (id, quest_id, member_student_ids) values (?, ?, ?)'),
  listTeamsByQuest: db.prepare('select * from teams where quest_id = ?'),
  getTeamById: db.prepare('select * from teams where id = ?'),
  insertSubmission: db.prepare('insert into submissions (id, team_id, submitted_by, file_id, caption) values (?, ?, ?, ?, ?)'),
  listSubmissionsByTeam: db.prepare('select * from submissions where team_id = ?'),
  getSubmission: db.prepare('select * from submissions where id = ?'),
  updateSubmissionVerification: db.prepare('update submissions set verification_status = ?, verified_by = ?, verified_at = current_timestamp where id = ?'),
  addPointsToUser: db.prepare('update users set points = coalesce(points,0) + ? where student_id = ?'),
  getUserByTelegram: db.prepare('select * from users where telegram_id = ?'),
  allUsers: db.prepare('select * from users'),
};