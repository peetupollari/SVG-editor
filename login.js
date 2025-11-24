// login.js
// This file handles: signIn, redirect to main.html, and preventing logged-in users from viewing login page.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

// <-- your firebase config (same as your signup code)
const firebaseConfig = {
  apiKey: "AIzaSyDBQn-9zj0rQnTRf7wmVNB2xWzNzaggaPk",
  authDomain: "website-64725.firebaseapp.com",
  projectId: "website-64725",
  storageBucket: "website-64725.firebasestorage.app",
  messagingSenderId: "160443299665",
  appId: "1:160443299665:web:d537fb65a57e64e20fc570"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// If user is already signed in, send them to main page immediately.
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Use replace so login page is not kept in history
    window.location.replace('dashboard.html');
  }
});

// Form handling
const form = document.getElementById('loginForm');
const messageEl = document.getElementById('message');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  messageEl.textContent = '';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    messageEl.textContent = 'Please enter email and password.';
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // successful login -> redirect to protected main.html
    window.location.replace('dashboard.html');
  } catch (err) {
    // Friendly error messages
    console.error('Login error', err);
    // Map some common Firebase errors to friendly text (optional)
    if (err.code === 'auth/wrong-password') {
      messageEl.textContent = 'Wrong password. Try again.';
    } else if (err.code === 'auth/user-not-found') {
      messageEl.textContent = 'No account found for that email.';
    } else if (err.code === 'auth/invalid-email') {
      messageEl.textContent = 'Invalid email address.';
    } else {
      messageEl.textContent = err.message || 'Login failed';
    }
  }
});
