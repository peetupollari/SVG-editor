// main.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

// OPTIONAL: if you want to load extra profile data from Firestore
import {
  getFirestore,
  doc,
  getDoc
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
  // el('userUid').textContent = user.uid;
  // el('userName').textContent = user.displayName ?? '—';
  // el('userProviders').textContent = (user.providerData && user.providerData.length)
  //   ? user.providerData.map(p => p.providerId).join(', ')
  //   : '—';
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
      el('profileExtra').innerHTML = `<h3>Extra profile data</h3><pre>${JSON.stringify(data, null, 2)}</pre>`;
    } else {
      el('profileExtra').innerHTML = `<p>No extra profile data found in Firestore.</p>`;
    }
  } catch (err) {
    console.warn('Could not fetch Firestore profile:', err);
  }
});

// Sign-out
document.getElementById('button').addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.replace('index.html');
  } catch (err) {
    document.getElementById('mainMessage').textContent = 'Sign-out failed: ' + err.message;
    console.error(err);
  }
});

//   // Delete-account
//   document.getElementById('button-delete-ac').addEventListener('click', async () => {
//     try {
//       await user?.delete();
//       window-location.replace('index.html');
//     }
// });


