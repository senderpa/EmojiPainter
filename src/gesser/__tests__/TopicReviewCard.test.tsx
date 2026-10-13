/**
 * GESSER FEATURE - TopicReviewCard Component Tests
 *
 * Tests for topic review UI component
 */

import React from 'react';
import { act } from 'react-test-renderer';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import TopicReviewCard from '../components/TopicReviewCard';
import GesserApi from '../api/gesserClient';

// Mock GesserApi
jest.mock('../api/gesserClient');

describe('TopicReviewCard', () => {
  const mockTopic = {
    id: 1,
    topic: 'Space Whale',
    submittedAt: '2026-02-07T00:00:00Z'
  };

  const mockDeviceId = 'device123';
  const mockOnReviewComplete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders topic correctly', () => {
    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    expect(getByText('Space Whale')).toBeTruthy();
    expect(getByText(/submitted/i)).toBeTruthy();
  });

  test('shows approve and reject buttons', () => {
    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    expect(getByText('Approve')).toBeTruthy();
    expect(getByText('Reject')).toBeTruthy();
  });

  test('shows reward text', () => {
    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    expect(getByText(/\+5 coins for reviewing/i)).toBeTruthy();
  });

  test('calls API when approve button pressed', async () => {
    (GesserApi.approveTopic as jest.Mock).mockResolvedValue({
      ok: true,
      message: 'Topic approved',
      coinsAwarded: 5
    });

    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    fireEvent.press(getByText('Approve'));

    await waitFor(() => {
      expect(GesserApi.approveTopic).toHaveBeenCalledWith(
        mockDeviceId,
        mockTopic.id,
        'approve'
      );
    });
  });

  test('calls API when reject button pressed', async () => {
    (GesserApi.approveTopic as jest.Mock).mockResolvedValue({
      ok: true,
      message: 'Topic rejected',
      coinsAwarded: 5
    });

    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    fireEvent.press(getByText('Reject'));

    await waitFor(() => {
      expect(GesserApi.approveTopic).toHaveBeenCalledWith(
        mockDeviceId,
        mockTopic.id,
        'reject'
      );
    });
  });

  test('calls onReviewComplete after successful approval', async () => {
    (GesserApi.approveTopic as jest.Mock).mockResolvedValue({
      ok: true,
      message: 'Topic approved',
      coinsAwarded: 5
    });

    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    fireEvent.press(getByText('Approve'));

    await waitFor(() => {
      expect(mockOnReviewComplete).toHaveBeenCalledWith(true, 5);
    });
  });

  test('calls onReviewComplete after successful rejection', async () => {
    (GesserApi.approveTopic as jest.Mock).mockResolvedValue({
      ok: true,
      message: 'Topic rejected',
      coinsAwarded: 5
    });

    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    fireEvent.press(getByText('Reject'));

    await waitFor(() => {
      expect(mockOnReviewComplete).toHaveBeenCalledWith(false, 5);
    });
  });

  test('shows loading indicator when processing', async () => {
    let resolveReview: any;
    const reviewPromise = new Promise((resolve) => {
      resolveReview = resolve;
    });

    (GesserApi.approveTopic as jest.Mock).mockReturnValue(reviewPromise);

    const { getByText, queryByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    // Press — setLoading(true) fires synchronously, then awaits the API promise
    await act(async () => {
      fireEvent.press(getByText('Approve'));
      await Promise.resolve(); // flush microtasks so setLoading(true) takes effect
    });

    // When loading, text labels are replaced by ActivityIndicator
    expect(queryByText('Approve')).toBeNull();

    await act(async () => {
      resolveReview({ ok: true, message: 'Topic approved', coinsAwarded: 5 });
    });
  });

  test('handles API error gracefully', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    (GesserApi.approveTopic as jest.Mock).mockRejectedValue(
      new Error('Network error')
    );

    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    fireEvent.press(getByText('Approve'));

    await waitFor(() => {
      expect(GesserApi.approveTopic).toHaveBeenCalled();
    });

    // Should not call onReviewComplete on error
    expect(mockOnReviewComplete).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  test('disables buttons while loading', async () => {
    let resolveReview: any;
    const reviewPromise = new Promise((resolve) => {
      resolveReview = resolve;
    });

    (GesserApi.approveTopic as jest.Mock).mockReturnValue(reviewPromise);

    const { getByText } = render(
      <TopicReviewCard
        topic={mockTopic}
        deviceId={mockDeviceId}
        onReviewComplete={mockOnReviewComplete}
      />
    );

    const { queryByText } = { queryByText: (text: string) => {
      try { return getByText(text); } catch { return null; }
    }};

    // Press approve — setLoading(true) fires synchronously
    await act(async () => {
      fireEvent.press(getByText('Approve'));
      await Promise.resolve();
    });

    // When loading, button labels are replaced by ActivityIndicator (text disappears)
    expect(queryByText('Approve')).toBeNull();
    expect(queryByText('Reject')).toBeNull();
    // API should be called exactly once
    expect(GesserApi.approveTopic).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReview({ ok: true, message: 'Topic approved', coinsAwarded: 5 });
    });
  });
});
