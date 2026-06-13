(function () {
  if (!["http:", "https:"].includes(window.location.protocol)) {
    return;
  }

  let apiRooms = [];
  let apiReviews = [];
  let apiReports = [];
  const postSubmitButton = document.querySelector("#postSubmitButton");
  const successMessage = document.querySelector("#successMessage");

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal,
      ...options
    }).finally(() => clearTimeout(timeout));
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }

  function setPostSubmitting(isSubmitting) {
    if (!postSubmitButton) return;
    postSubmitButton.disabled = isSubmitting;
    postSubmitButton.textContent = isSubmitting ? "Submitting room..." : "Submit Room";
  }

  function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.classList.add("is-visible");
  }

  function hideSuccess() {
    successMessage.classList.remove("is-visible");
  }

  async function loadPublicData() {
    const data = await api("/api/public");
    apiRooms = data.rooms || [];
    apiReviews = data.reviews || [];
    apiReports = data.reports || [];
    renderRooms();
    renderPublicReports();
  }

  window.getApprovedRooms = function () {
    return apiRooms;
  };

  window.getPendingRooms = function () {
    return [];
  };

  window.getAllRooms = function () {
    return apiRooms;
  };

  window.getApprovedReviews = function (roomId) {
    return apiReviews.filter((review) => review.roomId === roomId);
  };

  window.getPublicReports = function () {
    return apiReports;
  };

  window.renderRooms = function () {
    const rooms = filteredRooms();
    roomsGrid.innerHTML = rooms.length
      ? rooms.map(roomCard).join("")
      : `<p class="address">No rooms match the selected filters.</p>`;
  };

  document.addEventListener("submit", async (event) => {
    const reviewForm = event.target.closest("[data-review-form]");
    if (!reviewForm) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const roomId = reviewForm.dataset.reviewForm;
    const room = apiRooms.find((item) => item.id === roomId);
    await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        roomId,
        roomTitle: room ? room.title : "Room listing",
        name: reviewForm.elements.name.value.trim(),
        rating: reviewForm.elements.rating.value,
        comment: reviewForm.elements.comment.value.trim()
      })
    });
    reviewForm.reset();
    alert("Thank you. Your review was sent to admin for approval.");
  }, true);

  document.querySelector("#postForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    hideError();
    hideSuccess();
    setPostSubmitting(true);
    showSuccess("Submitting room to admin. Please wait until this message changes.");

    let uploadedImages = [];
    let uploadedVideo = "";
    try {
      uploadedImages = await uploadedRoomImages();
      uploadedVideo = await uploadedRoomVideo();
      await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          title: document.querySelector("#postTitle").value.trim(),
          address: document.querySelector("#postAddress").value.trim(),
          location: document.querySelector("#postLocation").value,
          type: document.querySelector("#postType").value,
          amount: money(document.querySelector("#postAmount").value),
          deposit: document.querySelector("#postDeposit").value.trim() || "No deposit stated",
          childFriendly: document.querySelector("#postChild").value,
          parking: document.querySelector("#postParking").value,
          bath: document.querySelector("#postBath").value.trim(),
          images: uploadedImages,
          video: uploadedVideo,
          posterName: document.querySelector("#posterName").value.trim(),
          posterContact: document.querySelector("#posterContact").value.trim(),
          notes: document.querySelector("#postNotes").value.trim()
        })
      });
    } catch (error) {
      const message = error.name === "AbortError"
        ? "The upload is taking too long. Try again with a shorter video or fewer pictures."
        : error.message || "Could not submit the room. Please try again.";
      hideSuccess();
      showError(message);
      setPostSubmitting(false);
      return;
    }

    event.target.reset();
    clearPreviewURLs();
    clearPreviewVideoURL();
    imagePreview.innerHTML = `<span class="hint">No pictures selected yet.</span>`;
    videoPreview.innerHTML = `<span class="hint">No video selected yet.</span>`;
    showSuccess("Room submitted to admin. Log in to admin and open Pending Posts to approve it.");
    setPostSubmitting(false);
    setTimeout(() => successMessage.classList.remove("is-visible"), 6500);
  }, true);

  document.querySelector("#scamForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    await api("/api/reports", {
      method: "POST",
      body: JSON.stringify({
        room: document.querySelector("#reportRoom").value.trim(),
        reporterContact: document.querySelector("#reporterContact").value.trim(),
        reason: document.querySelector("#reportReason").value.trim()
      })
    });
    event.target.reset();
    await loadPublicData();
    document.querySelector("#scamSuccess").classList.add("is-visible");
    setTimeout(() => document.querySelector("#scamSuccess").classList.remove("is-visible"), 4200);
  }, true);

  loadPublicData().catch((error) => {
    console.error(error);
    showError("Could not connect to the live room server yet. Refresh the page, then try again.");
  });
})();
