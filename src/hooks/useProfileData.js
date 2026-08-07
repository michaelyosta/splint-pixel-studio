import { useCallback, useState } from 'react';
import { api } from '../api/client';

export function useProfileData({ showNotice, onNavigate }) {
  const [profile, setProfile] = useState(null);
  const [profileArtworks, setProfileArtworks] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [profileShelf, setProfileShelf] = useState('works');

  const loadProfile = useCallback(async (userId = null) => {
    try {
      const nextProfile = await api(userId ? `/users/${userId}/profile` : '/users/me');
      const artworks = await api(`/users/${nextProfile.id}/artworks`);
      setProfile(nextProfile);
      setProfileArtworks(artworks.filter((artwork) => artwork.is_completed));
      if (!userId) setCurrentUser(nextProfile);
    } catch (error) {
      showNotice(error.message, 'error');
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
    loadProfile,
    openProfile,
    toggleProfileFollow,
  };
}
