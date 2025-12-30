# Subtitle Game Updated README:

An interactive game where players watch short video clips and submit their own subtitles in real-time. The Game Screen shows the video and submitted subtitles, the Remote controls playback, and each Player can type in subtitles.

Installation:

1. Clone the repository: git clone https://github.com/your-username/subtitle-game.git && cd subtitle-game
2. Install dependencies: npm install
3. Start the server: node server.js

Open interfaces:

- Game Screen: http://localhost:3000/game_screen.html
- Remote: http://localhost:3000/remote.html
- Player: http://localhost:3000/player.html

Project Structure:
/public
/public/videos # Video files for the game
game_screen.html # Main display interface
player.html # Player interface to submit subtitles
remote.html # Remote control interface
config.json # Video list, paths, and subtitle placeholders
server.js # Node.js server with Socket.IO
package.json

Quick Start Workflow:

1. Download a video using yt-dlp:
   yt-dlp -f best -o \"public/videos/temp_video.mp4\" \"VIDEO_URL\"

2. Trim and optionally add a black box overlay using FFmpeg:
   ffmpeg -i \"public/videos/temp_video.mp4\" -ss 00:00:10 -to 00:00:20 -vf \"drawbox=x=0:y=ih-80:width=iw:height=80:color=black@1:t=fill\" -c:a copy \"public/videos/video_1.mp4\"

3. Generate subtitles automatically using Whisper tiny:
   Use the provided Node.js script (generateTimestamps/addVideoToConfig) which will extract audio, call Whisper tiny, and update ./public/config.json with structure { \"videos\": [ { \"id\": \"video_1\", \"path\": \"./videos/video_1.mp4\", \"subtitles\": [ { \"start\": 0, \"end\": 3, \"placeholder\": \"1 ...\" }, { \"start\": 3, \"end\": 6, \"placeholder\": \"2 ...\" } ] } ] }. Temporary files (.wav/.json) are removed automatically.

4. Start server and open interfaces.

Dependencies required for scripts:

- yt-dlp: for downloading videos
- ffmpeg: for trimming and adding black box overlays
- Whisper (Python) with model 'tiny': for generating timestamps
- Node.js: to run the helper scripts

How It Works:

1. Player Connection: Players enter a username and connect to the server
2. Game State Updates: Server broadcasts video info, playback time, and selected player
3. Submitting Subtitles: Players fill in subtitles for the current video; they can only submit when all fields are completed
4. Video Change: When a new video loads, the server resets the subtitle inputs for each player
5. Remote Control: Can start, pause, or seek the video for all players

Technologies Used:

- Node.js, Express, Socket.IO, HTML/CSS/JS, FFmpeg, yt-dlp, Whisper tiny for fast automatic timestamp generation

Customization:

- Add videos: Place new video files in /public/videos and update config.json
- Subtitle placeholders: Defined automatically via Whisper script
- UI styling: Modify CSS in HTML files
- Black box overlay: Optionally hide embedded subtitles via FFmpeg drawbox filter

Contributing:

1. Fork the repository
2. Create a branch: feature/my-feature
3. Commit your changes and push
4. Open a Pull Request
