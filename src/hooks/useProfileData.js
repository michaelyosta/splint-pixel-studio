import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';

export function useProfileData({ showNotice, onNavigate }) {
  const [profile, setProfile] = useState(null);
  const [profileArtworks, setProfileArtworks] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [profileShelf, setProfileShelf] = useState('works');
  const profileRequestRef = useRef(0);
  const currentUserRequestRef = useRef(0);
  const currentUserRef = useRef(null);

  const loadCurrentUser = useCallback(async () => {
    const requestId = currentUserRequestRef.current + 1;
    currentUserRequestRef.current = requestId;
    try {
      const user = await api('/users/me');
      if (requestId !== currentUserRequestRef.current) return null;
      currentUserRef.current = user;
      setCurrentUser(user);
      return user;
    } catch (error) {
      if (requestId !== currentUserRequestRef.current) return null;
      showNotice(error.message, 'error');
      return null;
    }
  }, [showNotice]);

  const loadProfile = useCallback(async (userId = null) => {
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    if (!userId && currentUserRef.current) setProfile(currentUserRef.current);
    try {
      const nextProfile = await api(userId ? `/users/${userId}/profile` : '/users/me');
      if (requestId !== profileRequestRef.current) return null;
      setProfile(nextProfile);
      if (!userId) setCurrentUser(nextProfile);
      try {
        const artworks = await api(`/users/${nextProfile.id}/artworks`);
        if (requestId !== profileRequestRef.current) return null;
        setProfileArtworks(artworks.filter((artwork) => artwork.is_completed));
      } catch (error) {
        if (requestId !== profileRequestRef.current) return null;
        setProfileArtworks([]);
        showNotice(error.message, 'error');
      }
      return nextProfile;
    } catch (error) {
      if (requestId !== profileRequestRef.current) return null;
      showNotice(error.message, 'error');
      return null;
    }
  }, [showNotice]);

  const openProfile = useCallback(async (userId) => {
    await loadProfile(userId);
    onNavigate('profile');
  }, [loadProfile, onNavigate]);

  const toggleProfileFollow = useCallback(async () => {
    if (!profile || profile.id === currentUser?.id) return;
    try {
      const result = await api(`/users/${profile.id}/follow`, { method: 'POST' });
      setProfile((current) => ({ ...current, is_following: result.is_following, followers_count: Math.max(0, current.followers_count + (result.is_following ? 1 : -1)) }));
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }, [currentUser?.id, profile, showNotice]);

  return {
    profile,
    profileArtworks,
    currentUser,
    profileShelf,
    setProfileShelf,
    loadCurrentUser,
    loadProfile,
    openProfile,
    toggleProfileFollow,
  };
}
