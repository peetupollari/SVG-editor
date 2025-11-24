// signup.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

// Optional: Firestore if you want to save extra profile info on signup
import {
  getFirestore,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

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
const db = getFirestore(app); // optional; remove imports/this line if you don't use Firestore

// Grab the submit button (make sure your button has id="submit")
const submit = document.getElementById('submit');

submit.addEventListener("click", async function (e) {
  e.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    alert('Please fill out email and password.');
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Optional: create a Firestore profile document for the user
    // await setDoc(doc(db, 'users', user.uid), {
    //   email: user.email,
    //   createdAt: new Date().toISOString(),
    //   // add any other fields you want (displayName, role, etc.)
    // });

    // Redirect to main page after successful signup.
    // use replace() so the user can't go back to the signup page with the browser back button
    window.location.replace('dashboard.html');

  } catch (error) {
    console.error('Signup error', error);
    // Friendly messages for common errors:
    if (error.code === 'auth/email-already-in-use') {
      alert('That email is already registered. Try logging in.');
    } else if (error.code === 'auth/weak-password') {
      alert('Weak password. Use at least 6 characters.');
    } else if (error.code === 'auth/invalid-email') {
      alert('Invalid email address.');
    } else {
      alert('Error: ' + error.message);
    }
  }
});
