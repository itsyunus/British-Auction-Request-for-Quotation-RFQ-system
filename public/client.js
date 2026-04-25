function formatCountdown(targetIso, expiredLabel) {
  const deltaMs = new Date(targetIso).getTime() - Date.now();

  if (deltaMs <= 0) {
    return expiredLabel;
  }

  const totalSeconds = Math.floor(deltaMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

function wireCountdowns() {
  const nodes = document.querySelectorAll("[data-countdown-target]");

  if (!nodes.length) {
    return;
  }

  const tick = () => {
    nodes.forEach((node) => {
      const targetIso = node.getAttribute("data-countdown-target");
      const expiredLabel = node.getAttribute("data-expired-label") ?? "Closed";
      node.textContent = formatCountdown(targetIso, expiredLabel);
    });
  };

  tick();
  window.setInterval(tick, 1000);
}

function wireBidForm() {
  const form = document.querySelector("[data-bid-form]");

  if (!form) {
    return;
  }

  const totalPreview = form.querySelector("[data-total-preview]");
  const totalInputs = [...form.querySelectorAll("[data-total-input]")];
  const supplierSelect = form.querySelector("[data-supplier-select]");
  const carrierInput = form.querySelector("#carrierName");

  const updateTotal = () => {
    const total = totalInputs.reduce((sum, input) => sum + Number(input.value || 0), 0);
    totalPreview.textContent = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(total);
  };

  const syncCarrierName = () => {
    const selected = supplierSelect.selectedOptions[0];

    if (!selected) {
      return;
    }

    if (!carrierInput.value || carrierInput.value === carrierInput.dataset.lastSuggestedName) {
      const suggestedName = selected.getAttribute("data-supplier-name") ?? "";
      carrierInput.value = suggestedName;
      carrierInput.dataset.lastSuggestedName = suggestedName;
    }
  };

  totalInputs.forEach((input) => input.addEventListener("input", updateTotal));
  supplierSelect.addEventListener("change", syncCarrierName);

  updateTotal();
  syncCarrierName();
}

document.addEventListener("DOMContentLoaded", () => {
  wireCountdowns();
  wireBidForm();
});
