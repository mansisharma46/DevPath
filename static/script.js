// script.js — DevPath client-side logic
//
// Responsibilities:
//   - Theme initialisation (dark / light) with localStorage persistence
//   - Mobile navigation toggle
//   - Skill chip manager (add/remove skills)
//   - Form validation with per-field error messages
//   - Recommendation API call and loading states
//   - Result card rendering
//   - Code viewer panel (detail page)


// ============================================================
// THEME ENGINE
// ============================================================
// The theme system works in three parts:
//
//  Part A — Anti-FOUC inline script (in <head> of each template):
//    Sets html[data-theme] synchronously before the stylesheet is
//    evaluated, so the browser paints the correct colours on frame 1.
//
//  Part B — initTheme() (runs immediately below):
//    Syncs the toggle button aria-pressed + aria-label with the
//    already-applied theme. Adds the "theme-ready" class on the
//    next animation frame so CSS transitions become active only
//    AFTER the initial paint (preventing a colour transition flash
//    when the page first loads).
//
//  Part C — applyTheme(theme) (called on button click):
//    The single source of truth for all theme changes. Updates
//    data-theme, localStorage, aria-pressed, aria-label, and an
//    aria-live region so screen readers announce the change.
// ============================================================

(function () {

  // ---- Part B: sync button state once DOM is ready ----------
  function initTheme() {
    var html  = document.documentElement;
    var theme = html.dataset.theme || "light";

    // Sync every toggle button on the page (desktop + mobile versions)
    document.querySelectorAll(".theme-toggle").forEach(function (btn) {
      var isDark = theme === "dark";
      // aria-pressed = true when dark mode is ON
      btn.setAttribute("aria-pressed", isDark ? "true" : "false");
      // aria-label describes what clicking WILL do (not what IS active),
      // which is the recommended accessible pattern for toggle buttons.
      btn.setAttribute("aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
      );
    });

    // Add .theme-ready on the NEXT frame so CSS transitions are
    // suppressed during the initial render (avoids colour flash).
    requestAnimationFrame(function () {
      html.classList.add("theme-ready");
    });
  }

  // ---- Part C: apply a theme change -------------------------
  function applyTheme(theme) {
    var html   = document.documentElement;
    var isDark = theme === "dark";

    // 1. Apply via data attribute — CSS [data-theme="dark"] picks this up
    html.dataset.theme = theme;

    // 2. Persist the user's choice across sessions
    try { localStorage.setItem("devpath-theme", theme); } catch (e) { /* private browsing may block */ }

    // 3. Update every toggle button's accessible state
    document.querySelectorAll(".theme-toggle").forEach(function (btn) {
      btn.setAttribute("aria-pressed", isDark ? "true" : "false");
      btn.setAttribute("aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
      );
    });

    // 4. Announce the change to screen readers via a visually-hidden
    //    aria-live="polite" region injected once into the DOM.
    var liveRegion = document.getElementById("theme-announce");
    if (!liveRegion) {
      liveRegion = document.createElement("span");
      liveRegion.id = "theme-announce";
      // Visually hidden but readable by screen readers
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.style.cssText =
        "position:absolute;width:1px;height:1px;padding:0;overflow:hidden;" +
        "clip:rect(0,0,0,0);white-space:nowrap;border:0;";
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = isDark ? "Dark mode enabled." : "Light mode enabled.";
  }


  document.addEventListener("click", function (evt) {
    var btn = evt.target.closest(".theme-toggle");
    if (!btn) return;
    var current = document.documentElement.dataset.theme || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTheme);
  } else {
    initTheme();
  }

}());


// ============================================================
// Detect which page we are on
// ============================================================
var isIndexPage  = !!document.getElementById("recommend-form");
// !! trick turns the DOM result into a simple true/false
var isIndexPage = !!document.getElementById("recommend-form");
// PROJECT_ID is set by the server only on detail pages, so if it's missing we're elsewhere
var isDetailPage = typeof PROJECT_ID !== "undefined";

var modal = document.getElementById("github-modal-overlay");
var openModalBtn = document.getElementById("btn-show-github");
var closeModalBtn = document.getElementById("btn-close-github");
var fetchBtn = document.getElementById("btn-fetch-github");
var githubInput = document.getElementById("github-username");
var errorMsg = document.getElementById("github-modal-error");

// ============================================================
// Mobile navigation toggle
// ============================================================
(function initMobileNav() {
  var toggle = document.getElementById("nav-mobile-toggle"); //hamburger button
  var menu     = document.getElementById("nav-mobile-menu"); //dropdown menu 

  if (!toggle || !menu) return;

  toggle.addEventListener("click", function () {
    var isOpen = menu.classList.toggle("open");

    toggle.classList.toggle("open", isOpen);
    toggle.setAttribute("aria-expanded", isOpen);
  });

  menu.querySelectorAll(".nav-mobile-link").forEach(function (link) {
    link.addEventListener("click", function () {
      menu.classList.remove("open");
      toggle.classList.remove("open");
      // FIX: reset aria-expanded when menu closes via link click
      toggle.setAttribute("aria-expanded", "false");
    });
  });
})();

// ============================================================
// INDEX PAGE
// ============================================================
if (isIndexPage) {

  var form = document.getElementById("recommend-form");

  var submitBtn = document.getElementById("submit-btn");
  var btnLabel = document.getElementById("btn-label");
  var btnLoading = document.getElementById("btn-loading");

  var resultsSection = document.getElementById("results-section");
  var resultsGrid = document.getElementById("results-grid");
  var resultsLoadingEl = document.getElementById("results-loading");
  var resultsEmptyEl = document.getElementById("results-empty");
  var emptyMessageEl = document.getElementById("empty-message");

  var skillsHidden = document.getElementById("skills");
  var skillsTextInput = document.getElementById("skills-input");
  var chipsSelectedEl = document.getElementById("skill-chips-selected");

  var quickPickChips = document.querySelectorAll(".skill-chip");

  var selectedSkills = [];

  function resetSkillSelection() {

    selectedSkills = [];

    if (skillsHidden) skillsHidden.value = "";

    if (chipsSelectedEl) chipsSelectedEl.innerHTML = "";

    if (skillsTextInput) {
      skillsTextInput.value = "";
    }

    if (suggestionsDiv) {
      suggestionsDiv.innerHTML = "";
      suggestionsDiv.style.display = "none";
    }

    if (quickPickChips) {
      quickPickChips.forEach(function (chip) {
        chip.classList.remove("active", "selected");
        chip.setAttribute("aria-pressed", "false");
      });
    }

    clearFieldError("skills-error");
  }

  // ============================================================
  // Clear Filters
  // ============================================================
  var clearFiltersBtn = document.getElementById("clear-filters-btn");

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", function () {

      var recommendForm = document.getElementById("recommend-form");

      if (recommendForm) {

        recommendForm.reset();

        resetSkillSelection();

        if (skillsTextInput) {
          skillsTextInput.focus();
        }
      }
    });
  }

  form.addEventListener("reset", function () {

    window.setTimeout(function () {
      resetSkillSelection();

      if (skillsTextInput) {
        skillsTextInput.focus();
      }
    }, 0);
  });

  // ============================================================
  // Skills
  // ============================================================
  var availableSkills = [];

  if (
    typeof skills !== "undefined" &&
    Array.isArray(skills) &&
    skills.length > 0
  ) {
    availableSkills = skills.map(function (s) {
      return s.label;
    });
  } else {

    availableSkills = [
      "Python",
      "JavaScript",
      "Java",
      "C++",
      "HTML",
      "CSS",
      "React",
      "Node.js",
      "Django",
      "Flask",
      "SQL",
      "MongoDB"
    ];
  }

  var suggestionsDiv = document.getElementById("skills-suggestions");

  var visibleSuggestions = [];
  var activeSuggestionIndex = -1;

  function normalizeSkill(skill) {
    return skill.trim().toLowerCase();
  }

  function isSkillSelected(skill) {

    var normalizedSkill = normalizeSkill(skill);

    return selectedSkills.some(function (selectedSkill) {
      return normalizeSkill(selectedSkill) === normalizedSkill;
    });
  }

  function getCanonicalSkill(rawSkill) {

    var normalizedSkill = normalizeSkill(rawSkill);

    var matchedSkill = availableSkills.find(function (skill) {
      return normalizeSkill(skill) === normalizedSkill;
    });

    return matchedSkill || rawSkill.trim();
  }

  function addSkill(rawSkill) {

    var skill = getCanonicalSkill(rawSkill);

    if (!skill) return;

    if (isSkillSelected(skill)) return;

    selectedSkills.push(skill);

    renderSelectedChips();

    syncSkillsHiddenInput();

    updateQuickPickState();

    clearFieldError("skills-error");
  }

  function removeSkill(skill) {

    selectedSkills = selectedSkills.filter(function (selectedSkill) {

      return normalizeSkill(selectedSkill) !== normalizeSkill(skill);

    });

    renderSelectedChips();

    syncSkillsHiddenInput();

    updateQuickPickState();
  }

  function renderSelectedChips() {

    chipsSelectedEl.innerHTML = "";

    selectedSkills.forEach(function (skill) {

      var chipEl = document.createElement("span");

      chipEl.className = "skill-chip-selected";

      chipEl.textContent = skill;

      var removeBtn = document.createElement("button");

      removeBtn.type = "button";

      removeBtn.className = "skill-chip-remove";

      removeBtn.innerHTML = "&times;";

      removeBtn.addEventListener("click", function (e) {

        e.stopPropagation();

        removeSkill(skill);
      });

      chipEl.appendChild(removeBtn);

      chipsSelectedEl.appendChild(chipEl);
    });
  }

  function syncSkillsHiddenInput() {

    if (!skillsHidden) return;

    skillsHidden.value = selectedSkills.join(", ");
  }

  function updateQuickPickState() {

    quickPickChips.forEach(function (chip) {

      var skill = chip.getAttribute("data-skill");

      var isActive = isSkillSelected(skill || "");

      chip.classList.toggle("active", isActive);

      chip.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  quickPickChips.forEach(function (chip) {

    chip.addEventListener("click", function () {

      var skill = chip.getAttribute("data-skill");

      if (!skill) return;

      var alreadySelected = isSkillSelected(skill);

      if (alreadySelected) {
        removeSkill(skill);
      } else {
        addSkill(skill);
      }

      skillsTextInput.value = "";
    });
  });

  // ============================================================
  // Suggestions
  // ============================================================
  function getFilteredSkills(query) {

    var normalizedQuery = normalizeSkill(query);

    return availableSkills
      .filter(function (skill) {

        return (
          normalizeSkill(skill).includes(normalizedQuery) &&
          !isSkillSelected(skill)
        );

      })
      .slice(0, 8);
  }

  function hideSuggestions() {

    visibleSuggestions = [];
    activeSuggestionIndex = -1;

    if (suggestionsDiv) {
      suggestionsDiv.style.display = "none";
      suggestionsDiv.innerHTML = "";
    }
  }

  function selectSuggestion(skill) {

    addSkill(skill);

    skillsTextInput.value = "";

    hideSuggestions();

    skillsTextInput.focus();
  }

  function displaySuggestions(items) {

    if (!suggestionsDiv) return;

    visibleSuggestions = items;

    activeSuggestionIndex = -1;

    if (items.length === 0) {
      hideSuggestions();
      return;
    }

    suggestionsDiv.innerHTML = "";

    items.forEach(function (skill, index) {

      var item = document.createElement("div");

      item.className = "suggestion-item";

      item.textContent = skill;

      item.addEventListener("mousedown", function (evt) {
        evt.preventDefault();
      });

      item.addEventListener("click", function () {
        selectSuggestion(skill);
      });

      suggestionsDiv.appendChild(item);
    });

    suggestionsDiv.style.display = "block";
  }

  skillsTextInput.addEventListener("input", function (evt) {

    var typedValue = evt.target.value.trim();

    if (typedValue.length === 0) {
      hideSuggestions();
      return;
    }

    displaySuggestions(getFilteredSkills(typedValue));
  });

  skillsTextInput.addEventListener("keydown", function (evt) {

    if (evt.key === "Enter") {

      evt.preventDefault();

      if (
        activeSuggestionIndex >= 0 &&
        visibleSuggestions[activeSuggestionIndex]
      ) {

        selectSuggestion(visibleSuggestions[activeSuggestionIndex]);

        return;
      }

      if (skillsTextInput.value.trim()) {

        addSkill(skillsTextInput.value);

        skillsTextInput.value = "";
      }

      hideSuggestions();
    }
  });

  skillsTextInput.addEventListener("blur", function () {

    setTimeout(function () {
      hideSuggestions();
    }, 150);
  });

  // ============================================================
  // Validation
  // ============================================================
  function showFieldError(fieldId, message) {

    var el = document.getElementById(fieldId);

    if (el) el.textContent = message;
  }

  function clearFieldError(fieldId) {

    var el = document.getElementById(fieldId);

    if (el) el.textContent = "";
  }

  function clearAllErrors() {

    [
      "skills-error",
      "level-error",
      "interest-error",
      "time-error"
    ].forEach(clearFieldError);

    var generalErr = document.getElementById("form-error-general");

    if (generalErr) {
      generalErr.textContent = "";
    }
  }

  function validateForm() {

    var valid = true;

    if (selectedSkills.length === 0 && !skillsHidden.value.trim()) {

      showFieldError(
        "skills-error",
        "Please add at least one skill."
      );

      valid = false;
    }

    if (!document.getElementById("level").value) {

      showFieldError(
        "level-error",
        "Please select your experience level."
      );

      valid = false;
    }

    if (!document.getElementById("interest").value) {

      showFieldError(
        "interest-error",
        "Please select an area of interest."
      );

      valid = false;
    }

    if (!document.getElementById("time").value) {

      showFieldError(
        "time-error",
        "Please select your time availability."
      );

      valid = false;
    }

    return valid;
  }

  // ============================================================
  // Submit
  // ============================================================
  form.addEventListener("submit", function (evt) {

    evt.preventDefault();

    clearAllErrors();

    if (skillsTextInput.value.trim()) {

      addSkill(skillsTextInput.value);

      skillsTextInput.value = "";

      hideSuggestions();
    }

    if (!validateForm()) return;

    setLoadingState(true);

    requestAnimationFrame(function () {

      var payload = {

        skills:
          skillsHidden.value.trim() ||
          skillsTextInput.value.trim(),

        level: document.getElementById("level").value,

        interest: document.getElementById("interest").value,

        time: document.getElementById("time").value
      };

      fetch("/api/recommend", {

        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify(payload)

      })
        .then(function (res) {
          return res.json();
        })

        .then(function (data) {

          setLoadingState(false);

          if (data.error) {

            var generalErr =
              document.getElementById("form-error-general");

            if (generalErr) {
              generalErr.textContent = data.error;
            }

            return;
          }

          renderResults(data.projects || [], data.message);
        })

        .catch(function (err) {

          setLoadingState(false);

          var generalErr =
            document.getElementById("form-error-general");

          if (generalErr) {

            generalErr.textContent =
              "Something went wrong. Please try again.";
          }

          console.error(err);
        });
    });
  });

  // ============================================================
  // Loading
  // ============================================================
  function setLoadingState(isLoading) {

    submitBtn.disabled = isLoading;

    submitBtn.setAttribute("aria-busy", isLoading);

    btnLabel.style.display =
      isLoading ? "none" : "inline";

    btnLoading.style.display =
      isLoading ? "inline-flex" : "none";

    if (isLoading) {

      resultsSection.style.display = "block";

      resultsLoadingEl.style.display = "block";

      resultsGrid.style.display = "none";

      resultsEmptyEl.style.display = "none";

      resultsSection.scrollIntoView({
        behavior: "smooth"
      });

    } else {

      resultsLoadingEl.style.display = "none";

      resultsGrid.style.display = "grid";
    }
  }

  // ============================================================
  // Results
  // ============================================================
  function renderResults(projects, message) {

    resultsSection.style.display = "block";

    resultsLoadingEl.style.display = "none";

    resultsGrid.innerHTML = "";

    if (!projects || projects.length === 0) {

      resultsGrid.style.display = "none";

      resultsEmptyEl.style.display = "block";

      if (message && emptyMessageEl) {
        emptyMessageEl.textContent = message;
      }

      return;
    }

    resultsEmptyEl.style.display = "none";

    resultsGrid.style.display = "grid";

    projects.forEach(function (project) {

      resultsGrid.appendChild(buildProjectCard(project));
    });

    resultsSection.scrollIntoView({
      behavior: "smooth"
    });
  }

  function buildProjectCard(project) {

    var card = document.createElement("div");

    card.className = "project-card";

    var title = document.createElement("h3");

    title.className = "project-card-title";

    title.textContent = project.title;

    var desc = document.createElement("p");

    desc.className = "project-card-desc";

    desc.textContent = truncate(project.description, 120);

    var tagsRow = document.createElement("div");

    tagsRow.className = "project-card-tags";

    (project.skills || []).forEach(function (skill) {

      tagsRow.appendChild(createTag(skill, "skill"));
    });

    tagsRow.appendChild(
      createTag(
        project.level,
        "level " + (project.level || "").toLowerCase()
      )
    );

    tagsRow.appendChild(
      createTag("Time: " + project.time, "time")
    );

    var footer = document.createElement("div");

    footer.className = "project-card-footer";

    var link = document.createElement("a");

    link.className = "btn-details";

    link.textContent = "View Full Project";

    link.href = "/project/" + project.id;

    footer.appendChild(link);

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(tagsRow);
    card.appendChild(footer);

    return card;
  }

  function createTag(text, type) {

    var span = document.createElement("span");

    span.className = "project-tag project-tag--" + type;

    span.textContent = text;

    return span;
  }

  function truncate(text, maxLength) {

    if (!text) return "";

    return text.length > maxLength
      ? text.slice(0, maxLength) + "..."
      : text;
  }
}

} // end github modal handlers

/* ---- Scroll-to-top button ---- */

/* Show the button only when the user has scrolled more than 300px */
var SCROLL_THRESHOLD = 300;

var scrollTopBtn = document.getElementById("scroll-top-btn");

function handleScroll() {

  if (!scrollTopBtn) return;

  if (window.pageYOffset > SCROLL_THRESHOLD) {
    scrollTopBtn.classList.add("visible");
  } else {
    scrollTopBtn.classList.remove("visible");
  }
}

function scrollToTop() {

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

if (scrollTopBtn) {
    window.addEventListener('scroll', handleScroll);
    scrollTopBtn.addEventListener('click', scrollToTop);
}
}
