// main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  deleteUser
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDBQn-9zj0rQnTRf7wmVNB2xWzNzaggaPk",
  authDomain: "website-64725.firebaseapp.com",
  projectId: "website-64725",
  storageBucket: "website-64725.appspot.com",
  messagingSenderId: "160443299665",
  appId: "1:160443299665:web:d537fb65e20fc570"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const el = id => document.getElementById(id);

// Protect this page: if no user, send to login
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // not signed in
    window.location.replace('login.html');
    return;
  }

  // Fill basic auth data
  el('userEmail').textContent = user.email ?? '—';
  el('userCreated').textContent = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleString()
    : '—';
  el('userLastSignIn').textContent = user.metadata?.lastSignInTime
    ? new Date(user.metadata.lastSignInTime).toLocaleString()
    : '—';

  // Optionally: fetch extra profile data from Firestore (collection "users", doc == uid)
  try {
    const docRef = doc(db, 'users', user.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      // You can show it somewhere if you want
      console.log("Extra profile data:", data);
    }
  } catch (err) {
    console.warn('Could not fetch Firestore profile:', err);
  }
});

// Sign-out
document.getElementById('button-signout').addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.replace('index.html');
  } catch (err) {
    el('mainMessage').textContent = 'Sign-out failed: ' + err.message;
    console.error(err);
  }
});

// Delete account
document.getElementById('button-delete').addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) {
    el('mainMessage').textContent = 'No user is signed in.';
    return;
  }

  // Optional: ask for confirmation
  const confirmed = confirm("Are you sure you want to permanently delete your account? This action cannot be undone.");
  if (!confirmed) return;

  try {
    // If you also want to delete Firestore data:
    // await deleteDoc(doc(db, 'users', user.uid));

    // Delete the Auth user
    await deleteUser(user);
    
    // On success: redirect or show message
    el('mainMessage').textContent = 'Account deleted successfully.';
    // Perhaps redirect to home or signup page:
    window.location.replace('index.html');
  } catch (error) {
    console.error("Error deleting user:", error);
    // Handle specific error
    if (error.code === 'auth/requires-recent-login') {
      el('mainMessage').textContent = 'Please sign in again and then try deleting your account.';
      // Here, you might prompt the user to reauthenticate
    } else {
      el('mainMessage').textContent = 'Failed to delete account: ' + error.message;
    }
  }
});
