/**
 * Welcomer Video System
 * Loads random videos from assets/welcomer folder for the first-time welcome overlay
 */

// Import all welcomer videos
const WELCOMER_VIDEOS = [
  require('../../assets/welcomer/welcomer_video_1.mp4'),
  require('../../assets/welcomer/welcomer_video_2.mp4'),
  require('../../assets/welcomer/welcomer_video_3.mp4'),
  require('../../assets/welcomer/welcomer_video_4.mp4'),
  require('../../assets/welcomer/welcomer_video_5.mp4'),
  require('../../assets/welcomer/welcomer_video_6.mp4'),
  require('../../assets/welcomer/welcomer_video_7.mp4'),
  require('../../assets/welcomer/welcomer_video_8.mp4'),
  require('../../assets/welcomer/welcomer_video_9.mp4'),
  require('../../assets/welcomer/welcomer_video_10.mp4'),
  require('../../assets/welcomer/welcomer_video_11.mp4'),
  require('../../assets/welcomer/welcomer_video_12.mp4'),
  require('../../assets/welcomer/welcomer_video_13.mp4'),
  require('../../assets/welcomer/welcomer_video_14.mp4'),
  require('../../assets/welcomer/welcomer_video_15.mp4'),
  require('../../assets/welcomer/welcomer_video_16.mp4'),
  require('../../assets/welcomer/welcomer_video_17.mp4'),
  require('../../assets/welcomer/welcomer_video_18.mp4'),
  require('../../assets/welcomer/welcomer_video_19.mp4'),
  require('../../assets/welcomer/welcomer_video_20.mp4'),
  require('../../assets/welcomer/welcomer_video_21.mp4'),
  require('../../assets/welcomer/welcomer_video_22.mp4'),
  require('../../assets/welcomer/welcomer_video_23.mp4'),
  require('../../assets/welcomer/welcomer_video_24.mp4'),
  require('../../assets/welcomer/welcomer_video_25.mp4'),
];

/**
 * Get a random welcomer video source
 */
export const getRandomWelcomerVideo = () => {
  const randomIndex = Math.floor(Math.random() * WELCOMER_VIDEOS.length);
  return WELCOMER_VIDEOS[randomIndex];
};

/**
 * Get total count of welcomer videos
 */
export const getWelcomerVideoCount = () => WELCOMER_VIDEOS.length;
