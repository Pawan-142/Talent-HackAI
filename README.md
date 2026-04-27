# Talent Hack AI: AI-Powered Skill Assessment & Learning Plan Agent

Talent Hack AI is a sophisticated platform designed to bridge the gap between candidate qualifications and job requirements. Using advanced Gemini AI, it analyzes resumes against job descriptions (JD) to identify skill gaps and provide a personalized learning roadmap.

## 🚀 Architecture Overview

### 1. **Frontend (The Interface)**
- **Framework**: [React 19](https://react.dev/) with [Vite](https://vitejs.dev/) for high-performance builds.
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) for a modern, utility-first design.
- **Animations**: [Motion](https://motion.dev/) for smooth, interactive UI transitions.
- **Icons**: [Lucide React](https://lucide.dev/) for consistent, scalable iconography.
- **Markdown**: [React Markdown](https://github.com/remarkjs/react-markdown) for rendering AI-generated feedback.

### 2. **Backend & Persistence (The Foundation)**
- **Auth & Database**: [Firebase](https://firebase.google.com/) provides secure user authentication and real-time data storage via **Firestore**.
- **Data Model**: Structured around `Assessments` (storing JDs, resume analysis, and skill meshes) and nested `Messages` for the interactive AI chat.

### 3. **Intelligence (The Brain)**
- **AI Model**: Integrated with **Google Gemini API** (`@google/genai`) to perform:
  - **Skill Analysis**: Extraction of technical and soft skills from resumes.
  - **Gap Identification**: Comparing resume skills against job requirements.
  - **Roadmap Generation**: Creating actionable learning paths with topic-specific resources.

### 4. **Utility & Processing**
- **PDF Extraction**: [pdfjs-dist](https://github.com/mozilla/pdf.js) is used to parse text content from uploaded resumes.
- **PDF Export**: [jsPDF](https://github.com/parallax/jsPDF) enables users to download their personalized learning plans for offline use.

---

## ✨ Key Features

- **Neural Skill Mesh**: A visual representation of "Verified Matches" (skills you have) vs. "Gaps to Bridge" (skills you need).
- **Personalized Learning Plan**: Automatically generated roadmap with curated course links (prefixed with "View Course") and time estimates.
- **Interactive AI Assistant**: A dedicated chat interface to ask follow-up questions about your assessment.
- **Resume-JD Alignment**: Upload any Job Description and Resume to get an instant compatibility score.
- **Secure Cloud Storage**: Your assessments and feedback are stored securely in your private profile.

---

## 🛠️ Getting Started

### Prerequisites
- Node.js environment
- Firebase Project credentials
- Google Gemini API Key

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables (refer to `.env.example`).

3. Start the development server:
   ```bash
   npm run dev
   ```

---

## 🌐 Deployment (Netlify / Vercel)

When deploying to external platforms like Netlify or Vercel, ensure you follow these steps:

1. **Environment Variables**: You MUST set the following in your deployment dashboard:
   - `VITE_GEMINI_API_KEY`: Your Google Gemini API Key.
   - Any Firebase keys if you are using a custom Firebase project.

2. **Build Settings**:
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`

3. **PDF Support**: The application uses `pdfjs-dist` to process resumes. I have updated the worker configuration to use a CDN-based fallback (`cdnjs`) to ensure PDF parsing works reliably in production environments without complex local worker setup.

4. **Firebase Redirects**: If using Firebase Auth popups, ensure you've added your deployment URL to the "Authorized domains" list in the Firebase Console (Authentication > Settings).

---

## 📂 Project Structure

- `src/App.tsx`: The heart of the application, managing state, AI interactions, and the main layout.
- `src/lib/`: Utility functions for Firebase and AI service initialisation.
- `firebase-blueprint.json`: Defines the Firestore data architecture.
- `firestore.rules`: Secure access control for user data.
- `metadata.json`: Application capabilities and platform permissions.
