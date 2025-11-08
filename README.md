<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Study Sidekick

Study Sidekick is an AI-powered learning partner that helps you understand your course materials. Upload documents, chat about the content, and generate quizzes or flashcards to test your knowledge. This project is a simplified take on NotebookLM, built as a learning tool for engineers.

View your app in AI Studio: https://ai.studio/apps/drive/1wpFpWFhm-56cm2w8BS5RzUUPUzlITaHp

## Getting Started

Follow these instructions to get the project running on your local machine for development and testing.

### Prerequisites

You'll need to have [Node.js](https://nodejs.org/en) (version 20 or later) installed on your system.

### 1. Installation

This project contains both a frontend (Vite + React) and a backend (Express). The following command will install the necessary dependencies for both:

1.  Clone the repository to your local machine.
2.  Navigate to the project's root directory.
3.  Run the installation script:
    ```bash
    npm run install-all
    ```
    This command executes `npm install` in the root directory (for the frontend) and in the `api/` directory (for the backend).

### 2. Environment Setup

The backend server requires API keys and service credentials to connect to Gemini and Supabase.

1.  Navigate to the `api` directory: `cd api`
2.  Create a new file named `.env.local`.
3.  Copy and paste the following content into the file, replacing the placeholder values with your actual credentials.

    ```env
    # Get your key from Google AI Studio: https://makersuite.google.com/app/apikey
    API_KEY="YOUR_GEMINI_API_KEY"

    # --- Supabase Credentials ---
    # Find these in your Supabase Project Settings > API

    # The public URL for your Supabase project
    SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co"

    # The secret "service_role" key for your Supabase project.
    # This key is used for server-to-server communication and bypasses RLS.
    SUPABASE_SERVICE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY"

    # The public "anon" key for your Supabase project.
    # This key is safe to expose to the frontend.
    VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"

    # This is the same as SUPABASE_URL above. It is used to configure the client-side SDK.
    VITE_SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co"
    ```

4.  Return to the root directory: `cd ..`

## Running the Application

You can start both the frontend and backend servers with a single command from the root directory.

```bash
npm run dev
```

This will:
*   Start the frontend Vite development server, typically on `http://localhost:5173`.
*   Start the backend Express API server, typically on `http://localhost:3001`.
*   Open your browser and navigate to the frontend URL to use the app.

### Manual Startup (Separate Terminals)

For more detailed logging or debugging, you can run the frontend and backend in separate terminals.

**In Terminal 1 (from the root directory), start the frontend:**
```bash
npm run dev:frontend
```

**In Terminal 2 (from the root directory), start the backend:**
```bash
npm run dev:api
```