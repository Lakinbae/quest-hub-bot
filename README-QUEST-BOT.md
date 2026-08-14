AASTU Quest Telegram Bot — quick start

1. Install Node.js (Termux: pkg install nodejs)
2. Create files: package.json, bot.js, db.js, .env (from .env.example)
3. Install deps:
   npm install

4. Set .env with BOT_TOKEN and ADMIN_IDS
5. Start the bot:
   node bot.js

6. Use the bot in Telegram:
   - /register <student_id> <section>
   - /createquest <id> | <title> | <min> | <max> | <points>   (admin)
   - /join <questId>
   - /mix <questId>   (admin)
   - /teams <questId>
   - /submit <teamId> then send photo/file as reply or with caption
   - /verify <submissionId>   (admin)
   - /leaderboard

Notes:
- Files are stored as Telegram file_id. Admins can download via Telegram or use Bot API getFile.
- Database file: aastu-quest.db in the same folder.
- To run persistently, use pm2 or run inside a screen/tmux session.