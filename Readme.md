# Subtitle Game

An interactive game where players watch short video clips and submit their own subtitles in real-time. The **Game Screen** shows the video and submitted subtitles, the **Remote** controls playback, and each **Player** can type in subtitles.

---

## Table of Contents

- [Subtitle Game](#subtitle-game)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Installation](#installation)
  - [Project Structure](#project-structure)
  - [Quick Start Workflow](#quick-start-workflow)
  - [How It Works](#how-it-works)
  - [Technologies Used](#technologies-used)
  - [Customization](#customization)
  - [Contributing](#contributing)

---

## Overview

Players are shown a video and can write subtitles for it. The Game Screen displays:

1. The video playing in sync
2. Subtitles submitted by the selected player
3. A control interface (via Remote) to play, pause, or seek the video

The game works in real-time using **Socket.IO** for communication between the server, game screen, remote, and players.

---

## Installation

1. Clone the repository:

```bash
git clone https://github.com/your-username/subtitle-game.git
cd subtitle-game
```

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
node server.js
```

4. Open interfaces:

- Game Screen: http://localhost:3000/game_screen.html
- Remote: http://localhost:3000/remote.html
- Player: http://localhost:3000/player.html

---

## Project Structure

/public
/videos # Video files for the game
game_screen.html # Main display interface
player.html # Player interface to submit subtitles
remote.html # Remote control interface
config.json # Video list, paths, and subtitle placeholders
server.js # Node.js server with Socket.IO
package.json

---

## Quick Start Workflow

1. Download a video using yt-dlp:

```bash
   yt-dlp -f best -o \"public/videos/temp_video.mp4\" \"VIDEO_URL\"
```

2. Trim and optionally add a black box overlay using FFmpeg:

```bash
   ffmpeg -i \"public/videos/temp_video.mp4\" -ss 10 -to 20 -vf \"drawbox=x=0:y=ih-80:width=iw:height=80:color=black@1:t=fill\" -c:a copy \"public/videos/video_1.mp4\"
```

3. Update config.json with the new video and subtitle placeholders:

```
{
  \"videos\": [
    {
      \"path\": \"public/videos/video_1.mp4\",
      \"subtitles\": [
        { \"start\": 0, \"end\": 3, \"placeholder\": \"Hello world\" },
        { \"start\": 3, \"end\": 6, \"placeholder\": \"How are you?\" }
      ]
    }
  ]
}
```

4. Start the server and open the interfaces.

---

## How It Works

1. Player Connection: Players enter a username and connect to the server
2. Game State Updates: Server broadcasts video info, playback time, and selected player
3. Submitting Subtitles: Players fill in subtitles for the current video; they can only submit when all fields are completed
4. Video Change: When a new video loads, the server resets the subtitle inputs for each player
5. Remote Control: Can start, pause, or seek the video for all players

---

## Technologies Used

- Node.js: backend server
- Express: serving static pages
- Socket.IO: real-time communication
- HTML / CSS / JS: front-end interfaces
- FFmpeg / yt-dlp: optional for downloading and trimming videos

---

## Customization

- Add videos: Place new video files in /public/videos and update config.json
- Subtitle placeholders: Define subtitles array with start, end, and placeholder for each clip
- UI styling: Modify CSS in HTML files
- Black box overlay: Optionally hide embedded subtitles via FFmpeg drawbox filter

---

## Contributing

1. Fork the repository
2. Create a branch: feature/my-feature
3. Commit your changes and push
4. Open a Pull Request
