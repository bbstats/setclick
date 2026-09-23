# setclick
Planning-Center integrated metronome application

<img width="1595" height="899" alt="image" src="https://github.com/user-attachments/assets/b8e304ff-5fab-474c-b530-7594db7a3307" />

The whole app is `metronome.html`: one file with no build step. Host it anywhere static (for example GitHub Pages), open it on a phone or iPad, and add it to the home screen.

## Setup

1. Create a Planning Center [Personal Access Token](https://api.planningcenteronline.com/oauth/applications) (App ID + Secret).
2. Make a Cloudflare Worker that relays requests to `https://api.planningcenteronline.com`:
   - Save the App ID and Secret as Worker environment variables. The Worker adds the `Authorization: Basic …` header itself, so the app never sees your credentials.
   - Return CORS headers (`Access-Control-Allow-Origin`) so the browser can read the response.
   - **Only allow `GET` requests under `/services/v2/`.** Anyone who has the Worker URL can use it, so an open relay would expose your whole Planning Center account, People data included.
3. In SetClick, open Settings, paste the Worker URL, and tap **Save & test connection**.
