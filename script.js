let database = null;
let storage = null;

const firebaseConfig = {
    apiKey: "AIzaSyA05xyAudLNPrSI1vpG_81LCuJwQsrCYfk",
    authDomain: "edutech--teacher-panel.firebaseapp.com",
    projectId: "edutech--teacher-panel",
    storageBucket: "edutech--teacher-panel.firebasestorage.app",
    messagingSenderId: "468672525872",
    appId: "1:468672525872:web:bf68a24225274fc8d75ff5",
    measurementId: "G-2NZ5W8M2D8",
    databaseURL: "https://edutech--teacher-panel-default-rtdb.firebaseio.com"
};

// Initialize Firebase
try {
    if (!firebase) {
        throw new Error("Firebase SDK not loaded");
    }
    if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL || !firebaseConfig.projectId) {
        throw new Error("Invalid Firebase configuration");
    }
    const app = firebase.initializeApp(firebaseConfig);
    database = firebase.database();
    storage = firebase.storage();
    console.log("Firebase initialized successfully");
} catch (error) {
    console.error("Firebase initialization error:", error);
    showNotification("Failed to initialize Firebase: " + error.message, "error");
}

let currentUser = null;
let teacherId = null;
let studentData = null;
let homework = [];
let attendance = {};
let sessionalMarks = [];
let classes = [];
let currentPage = 1;
const itemsPerPage = 10;
const charts = {};

// Utility to generate a UUID for session tokens
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Authentication Functions
async function studentLogin(rollNumber, password) {
    try {
        if (!database) {
            throw new Error("Database not initialized");
        }
        const teachersRef = database.ref("teachers");
        const teachersSnapshot = await teachersRef.once("value");
        const teachers = teachersSnapshot.val() || {};

        for (const [teacherUid, teacherData] of Object.entries(teachers)) {
            const students = teacherData.students || {};
            const studentEntry = Object.entries(students).find(
                ([id, s]) => s.rollNumber === rollNumber && s.password === password
            );
            if (studentEntry) {
                const sessionToken = generateUUID();
                const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
                await database.ref(`teachers/${teacherUid}/students/${studentEntry[0]}/sessionToken`).set({
                    token: sessionToken,
                    expiresAt: expiresAt
                });
                localStorage.setItem('studentSession', JSON.stringify({
                    teacherId: teacherUid,
                    studentId: studentEntry[0],
                    sessionToken: sessionToken
                }));
                return {
                    teacherUid,
                    id: studentEntry[0],
                    ...studentEntry[1]
                };
            }
        }
        throw new Error("Invalid roll number or password");
    } catch (error) {
        console.error("Login error:", error);
        throw new Error(error.message || "Failed to log in");
    }
}

async function validateSession() {
    try {
        const session = JSON.parse(localStorage.getItem('studentSession'));
        if (!session || !session.teacherId || !session.studentId || !session.sessionToken) {
            console.log("No valid session found in localStorage");
            return null;
        }
        const snapshot = await database.ref(`teachers/${session.teacherId}/students/${session.studentId}`).once("value");
        const student = snapshot.val();
        if (!student || !student.sessionToken || student.sessionToken.token !== session.sessionToken || student.sessionToken.expiresAt < Date.now()) {
            console.log("Session invalid or expired");
            localStorage.removeItem('studentSession');
            return null;
        }
        console.log("Session validated successfully:", student);
        return {
            teacherUid: session.teacherId,
            id: session.studentId,
            ...student
        };
    } catch (error) {
        console.error("Session validation error:", error);
        localStorage.removeItem('studentSession');
        return null;
    }
}

async function logout() {
    try {
        if (studentData && teacherId) {
            await database.ref(`teachers/${teacherId}/students/${studentData.id}/sessionToken`).remove();
        }
        localStorage.removeItem('studentSession');
        studentData = null;
        teacherId = null;
        currentUser = null;
        const loginModal = document.getElementById("studentLoginModal");
        const studentPanel = document.getElementById("studentPanel");
        if (loginModal && studentPanel) {
            loginModal.classList.add("modal-visible");
            loginModal.classList.remove("hidden");
            studentPanel.classList.add("hidden");
        }
        showNotification("Logged out successfully!");
    } catch (error) {
        console.error("Logout error:", error);
        throw new Error(error.message);
    }
}

// Data Operations
async function saveData(path, data) {
    try {
        if (!database) {
            throw new Error("Database not initialized");
        }
        const newRef = database.ref(path).push();
        await newRef.set({ ...data, id: newRef.key });
        return newRef.key;
    } catch (error) {
        console.error("Save data error:", error);
        throw new Error(error.message);
    }
}

async function updateData(path, data) {
    try {
        if (!database) {
            throw new Error("Database not initialized");
        }
        await database.ref(path).update(data);
    } catch (error) {
        console.error("Update data error:", error);
        throw new Error(error.message);
    }
}

function listenToData(path, callback, query = null) {
    try {
        if (!database) {
            throw new Error("Database not initialized");
        }
        let dataRef = database.ref(path);
        if (query) {
            dataRef = query(dataRef);
        }
        dataRef.on("value", (snapshot) => {
            const data = snapshot.val();
            console.log(`Data fetched for ${path}:`, JSON.stringify(data, null, 2));
            const formattedData = path.includes("attendance") ? (data || {}) : (data ? Object.entries(data).map(([id, value]) => ({ id, ...value })) : []);
            callback(formattedData);
        }, (error) => {
            console.error(`Error listening to ${path}:`, error);
            showNotification(`Error loading ${path}: ${error.message}`, "error");
        });
        return () => dataRef.off();
    } catch (error) {
        console.error("Error setting up data listener:", error);
        showNotification("Error loading data: " + error.message, "error");
    }
}

async function getData(path) {
    try {
        if (!database) {
            throw new Error("Database not initialized");
        }
        const snapshot = await database.ref(path).once("value");
        const data = snapshot.val();
        console.log(`Manual fetch for ${path}:`, JSON.stringify(data, null, 2));
        return data;
    } catch (error) {
        console.error("Error fetching data from", path, ":", error);
        throw new Error(error.message);
    }
}

// UI Operations
function updateFormOptions(homework) {
    const select = document.getElementById("homeworkSelect");
    if (select) {
        select.innerHTML = `<option value="">Select Homework</option>` + 
            homework
                .filter(h => h.status === "Pending" && (h.target === "all" || h.targetSpecific === studentData?.id || h.targetSpecific === studentData?.classId))
                .map(h => `<option value="${h.id}">${h.title}</option>`).join("");
    } else {
        console.warn("homeworkSelect element not found");
    }
}

function updateClassDisplay(classes, studentData) {
    const classInput = document.getElementById("settingsClass");
    if (classInput) {
        classInput.value = classes.find(c => c.id === studentData?.classId)?.name || "Unknown";
    } else {
        console.warn("settingsClass element not found");
    }
}

function loadHomework(homework, studentData, page) {
    if (!studentData) {
        console.warn("loadHomework: studentData is null");
        showNotification("Error: Student data not loaded", "error");
        return;
    }
    currentPage = Math.max(1, page);
    let filtered = homework.filter(h => h.target === "all" || h.targetSpecific === studentData.id || h.targetSpecific === studentData.classId);
    const search = document.getElementById("homeworkSearchInput")?.value.toLowerCase() || "";
    const statusFilter = document.getElementById("homeworkStatusFilter")?.value || "";
    if (search) filtered = filtered.filter(h => h.title.toLowerCase().includes(search));
    if (statusFilter) filtered = filtered.filter(h => h.status === statusFilter);
    const totalPages = Math.ceil(filtered.length / itemsPerPage);
    currentPage = Math.min(currentPage, totalPages || 1);
    const start = (currentPage - 1) * itemsPerPage;
    const paginated = filtered.slice(start, start + itemsPerPage);

    const tbody = document.querySelector("#homeworkTable tbody");
    if (tbody) {
        tbody.innerHTML = paginated.length ? paginated.map(h => `
            <tr>
                <td>${h.title}</td>
                <td>${h.description}</td>
                <td>${h.dueDate}</td>
                <td>${h.fileUrl ? `<a href="${h.fileUrl}" target="_blank" class="action-btn download-btn">Download</a>` : "None"}</td>
                <td>${h.status}</td>
                <td>${h.status === "Pending" ? `<button class="action-btn submit-btn" data-id="${h.id}">Submit</button>` : "Submitted"}</td>
            </tr>
        `).join("") : "<tr><td colspan='6'>No homework found.</td></tr>";
    } else {
        console.error("homeworkTable tbody not found");
        showNotification("Error: Homework table not found", "error");
    }
    const pageInfo = document.getElementById("homeworkPageInfo");
    if (pageInfo) {
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    }
    const prevBtn = document.getElementById("homeworkPrevPageBtn");
    const nextBtn = document.getElementById("homeworkNextPageBtn");
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage === totalPages;
}

function loadAttendance(attendanceData, studentData) {
    console.log("loadAttendance called with studentData:", JSON.stringify(studentData, null, 2));
    console.log("Attendance data:", JSON.stringify(attendanceData, null, 2));

    const tbody = document.querySelector("#attendanceTable tbody");
    if (!tbody) {
        console.error("Attendance table body not found");
        showNotification("Error: Attendance table not found", "error");
        return;
    }

    const dateFilter = document.getElementById("attendanceDateFilter")?.value || "";
    let records = [];

    if (!studentData || !studentData.classId) {
        console.warn("No classId in studentData");
        showNotification("No class assigned to this student", "error");
        tbody.innerHTML = "<tr><td colspan='2'>No class assigned.</td></tr>";
        return;
    }

    if (attendanceData && attendanceData[studentData.classId]) {
        console.log(`Fetching attendance for classId: ${studentData.classId}`);
        records = Object.entries(attendanceData[studentData.classId])
            .map(([date, students]) => ({
                date,
                status: students && students[studentData.id] ? students[studentData.id] : "Unknown"
            }))
            .filter(record => record.status !== "Unknown" && (!dateFilter || record.date === dateFilter));
        console.log("Filtered attendance records:", JSON.stringify(records, null, 2));
    } else {
        console.warn("No attendance data or invalid classId:", {
            classId: studentData.classId,
            attendanceData: attendanceData
        });
    }

    tbody.innerHTML = records.length ? records.map(r => `
        <tr>
            <td>${r.date}</td>
            <td>${r.status}</td>
        </tr>
    `).join("") : "<tr><td colspan='2'>No attendance records found.</td></tr>";
}

function loadSessionalMarks(marks, page) {
    if (!studentData) {
        console.warn("loadSessionalMarks: studentData is null");
        showNotification("Error: Student data not loaded", "error");
        return;
    }
    currentPage = Math.max(1, page);
    let filtered = marks.filter(m => m.studentId === studentData.id);
    const search = document.getElementById("marksSearchInput")?.value.toLowerCase() || "";
    const examTypeFilter = document.getElementById("marksExamTypeFilter")?.value || "";
    if (search) filtered = filtered.filter(m => m.subject.toLowerCase().includes(search));
    if (examTypeFilter) filtered = filtered.filter(m => m.examType === examTypeFilter);
    const totalPages = Math.ceil(filtered.length / itemsPerPage);
    currentPage = Math.min(currentPage, totalPages || 1);
    const start = (currentPage - 1) * itemsPerPage;
    const paginated = filtered.slice(start, start + itemsPerPage);

    const tbody = document.querySelector("#marksTable tbody");
    if (tbody) {
        tbody.innerHTML = paginated.length ? paginated.map(m => `
            <tr>
                <td>${m.subject}</td>
                <td>${m.examType}</td>
                <td>${m.marks}</td>
                <td>${m.maxMarks}</td>
                <td>${((m.marks / m.maxMarks) * 100).toFixed(2)}%</td>
                <td>${m.date}</td>
            </tr>
        `).join("") : "<tr><td colspan='6'>No marks found.</td></tr>";
    } else {
        console.error("marksTable tbody not found");
        showNotification("Error: Marks table not found", "error");
    }
    const pageInfo = document.getElementById("marksPageInfo");
    if (pageInfo) {
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    }
    const prevBtn = document.getElementById("marksPrevPageBtn");
    const nextBtn = document.getElementById("marksNextPageBtn");
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage === totalPages;
}

function loadAnalytics(homework, sessionalMarks, studentData) {
    if (!studentData) {
        console.warn("loadAnalytics: studentData is null");
        showNotification("Error: Student data not loaded", "error");
        return;
    }
    if (!window.Chart) {
        console.error("Chart.js not loaded");
        showNotification("Error: Chart library not loaded", "error");
        return;
    }
    const ctxIds = ["homeworkStatusChart", "marksDistributionChart"];
    ctxIds.forEach(id => {
        if (charts[id]) charts[id].destroy();
    });

    const filteredHomework = homework.filter(h => 
        h.target === "all" || h.targetSpecific === studentData.id || h.targetSpecific === studentData.classId
    );
    const pending = filteredHomework.filter(h => h.status === "Pending").length;
    const submitted = filteredHomework.filter(h => h.status === "Submitted").length;

    const homeworkChartCanvas = document.getElementById("homeworkStatusChart");
    if (homeworkChartCanvas) {
        charts.homeworkStatusChart = new Chart(homeworkChartCanvas, {
            type: "bar",
            data: {
                labels: ["Pending", "Submitted"],
                datasets: [{ label: "Homework", data: [pending, submitted], backgroundColor: ["#e74c3c", "#2ecc71"] }]
            },
            options: { scales: { y: { beginAtZero: true } } }
        });
    } else {
        console.warn("homeworkStatusChart canvas not found");
    }

    const filteredMarks = sessionalMarks.filter(m => m.studentId === studentData.id);
    const marksBySubject = filteredMarks.reduce((acc, m) => {
        acc[m.subject] = acc[m.subject] || { total: 0, count: 0 };
        acc[m.subject].total += m.marks / m.maxMarks * 100;
        acc[m.subject].count++;
        return acc;
    }, {});

    const marksChartCanvas = document.getElementById("marksDistributionChart");
    if (marksChartCanvas) {
        charts.marksDistributionChart = new Chart(marksChartCanvas, {
            type: "bar",
            data: {
                labels: Object.keys(marksBySubject),
                datasets: [{
                    label: "Average Marks %",
                    data: Object.values(marksBySubject).map(m => m.count > 0 ? m.total / m.count : 0),
                    backgroundColor: "#3498db"
                }]
            },
            options: { scales: { y: { beginAtZero: true, max: 100 } } }
        });
    } else {
        console.warn("marksDistributionChart canvas not found");
    }
}

function toggleSection(sectionId) {
    document.querySelectorAll(".data-section, .form-section").forEach(section => {
        section.classList.toggle("hidden", section.id !== sectionId);
    });
}

function resetForm(formId) {
    const form = document.getElementById(formId);
    if (form) form.reset();
    else console.warn(`Form ${formId} not found`);
}

function showNotification(message, type = "success") {
    const notification = document.createElement("div");
    notification.textContent = message;
    notification.classList.add("notification", type === "success" ? "notification-success" : "notification-error");
    notification.style.position = "fixed";
    notification.style.top = "20px";
    notification.style.right = "20px";
    notification.style.padding = "10px 20px";
    notification.style.background = type === "success" ? "#2ecc71" : "#e74c3c";
    notification.style.color = "#fff";
    notification.style.borderRadius = "8px";
    notification.style.zIndex = "10001";
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function showLoading() {
    const loadingEl = document.getElementById("studentLoading");
    if (loadingEl) {
        loadingEl.textContent = "Loading...";
        loadingEl.classList.remove("hidden");
        loadingEl.classList.add("loading-visible");
    }
}

function showUploading() {
    const loadingEl = document.getElementById("studentLoading");
    if (loadingEl) {
        loadingEl.textContent = "Uploading...";
        loadingEl.classList.remove("hidden");
        loadingEl.classList.add("loading-visible");
    }
}

function hideLoading() {
    const loadingEl = document.getElementById("studentLoading");
    if (loadingEl) {
        loadingEl.classList.add("hidden");
        loadingEl.classList.remove("loading-visible");
    }
}

// Main Logic
function initializeTheme() {
    const theme = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", theme);
    const themeSelect = document.getElementById("studentThemeSelect");
    if (themeSelect) themeSelect.value = theme;
}

function setupMobileMenu() {
    const hamburgerBtn = document.getElementById("studentHamburgerBtn");
    const sidebar = document.getElementById("studentSidebar");
    if (hamburgerBtn && sidebar) {
        hamburgerBtn.addEventListener("click", () => {
            sidebar.classList.toggle("active");
            document.body.style.overflow = sidebar.classList.contains("active") ? "hidden" : "auto";
        });
        document.addEventListener("click", (e) => {
            if (window.innerWidth <= 768 && !sidebar.contains(e.target) && !hamburgerBtn.contains(e.target) && sidebar.classList.contains("active")) {
                sidebar.classList.remove("active");
                document.body.style.overflow = "auto";
            }
        });
    } else {
        console.warn("Hamburger button or sidebar not found");
    }
}

function setupRealTimeListeners() {
    if (!teacherId) {
        console.error("setupRealTimeListeners: teacherId is null");
        showNotification("Error: No teacher ID available", "error");
        return () => {};
    }
    const listeners = [];
    const paths = {
        "homework": data => {
            homework = data || [];
            loadHomework(homework, studentData, 1);
            updateFormOptions(homework);
            loadAnalytics(homework, sessionalMarks, studentData);
            loadHomeData();
        },
        "attendance": data => {
            console.log("Real-time attendance update:", JSON.stringify(data, null, 2));
            attendance = data || {};
            loadAttendance(attendance, studentData);
            loadHomeData();
        },
        "sessionalMarks": data => {
            sessionalMarks = data ? data.filter(m => m.studentId === studentData?.id) : [];
            loadSessionalMarks(sessionalMarks, 1);
            loadAnalytics(homework, sessionalMarks, studentData);
            loadHomeData();
        },
        "classes": data => {
            classes = data || [];
            updateClassDisplay(classes, studentData);
        }
    };
    Object.entries(paths).forEach(([path, callback]) => {
        const cleanup = listenToData(`teachers/${teacherId}/${path}`, callback);
        listeners.push(cleanup);
    });
    return () => listeners.forEach(cleanup => cleanup());
}

function loadHomeData() {
    if (!studentData) {
        console.warn("loadHomeData: studentData is null");
        showNotification("Error: Student data not loaded", "error");
        return;
    }
    const studentNameEl = document.getElementById("studentName");
    if (studentNameEl) studentNameEl.textContent = studentData.name || "Unknown";
    const settingsRollNumberEl = document.getElementById("settingsRollNumber");
    if (settingsRollNumberEl) settingsRollNumberEl.value = studentData.rollNumber || "";

    const filteredHomework = homework.filter(h => 
        h.target === "all" || h.targetSpecific === studentData.id || h.targetSpecific === studentData.classId
    );
    const pendingHomeworkEl = document.getElementById("pendingHomework");
    if (pendingHomeworkEl) pendingHomeworkEl.textContent = filteredHomework.filter(h => h.status === "Pending").length;
    const submittedHomeworkEl = document.getElementById("submittedHomework");
    if (submittedHomeworkEl) submittedHomeworkEl.textContent = filteredHomework.filter(h => h.status === "Submitted").length;

    const attendanceRecords = attendance[studentData.classId] 
        ? Object.entries(attendance[studentData.classId]).flatMap(([date, data]) => 
            Object.entries(data).map(([id, status]) => ({ id, status }))
        ).filter(r => r.id === studentData.id)
        : [];
    const presentCount = attendanceRecords.filter(r => r.status === "Present").length;
    const totalDays = attendanceRecords.length;
    const attendanceRateEl = document.getElementById("attendanceRate");
    if (attendanceRateEl) attendanceRateEl.textContent = totalDays ? `${Math.round((presentCount / totalDays) * 100)}%` : "0%";

    const nextDue = filteredHomework
        .filter(h => h.status === "Pending")
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0]?.dueDate || "N/A";
    const nextDueDateEl = document.getElementById("nextDueDate");
    if (nextDueDateEl) nextDueDateEl.textContent = nextDue;

    const quotes = ["Stay focused!", "Keep learning!", "You got this!"];
    const dailyQuoteEl = document.getElementById("dailyQuote");
    if (dailyQuoteEl) dailyQuoteEl.textContent = quotes[Math.floor(Math.random() * quotes.length)];
}

async function submitHomework(homeworkId, file, notes) {
    try {
        if (!storage) {
            throw new Error("Storage not initialized");
        }
        const allowedTypes = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (!allowedTypes.includes(file.type)) {
            throw new Error("Only PDF and Word documents are allowed");
        }
        if (file.size > maxSize) {
            throw new Error("File size exceeds 10MB limit");
        }
        showUploading();
        const fileRef = storage.ref(`teachers/${teacherId}/submissions/${studentData.id}/${Date.now()}_${file.name}`);
        await fileRef.put(file);
        const fileUrl = await fileRef.getDownloadURL();
        await updateData(`teachers/${teacherId}/homework/${homeworkId}`, {
            status: "Submitted",
            submission: { studentId: studentData.id, fileUrl, notes, submittedAt: new Date().toISOString() }
        });
        showNotification("Homework submitted successfully!");
    } catch (error) {
        console.error("Error submitting homework:", error);
        showNotification("Error submitting homework: " + error.message, "error");
    } finally {
        hideLoading();
    }
}

function setupEventListeners() {
    // Login
    const loginForm = document.getElementById("studentLoginForm");
    if (loginForm) {
        loginForm.removeEventListener("submit", handleLogin);
        loginForm.addEventListener("submit", handleLogin);
    } else {
        console.warn("studentLoginForm not found");
    }

    // Close Login Modal
    const closeLoginBtn = document.getElementById("closeStudentLoginBtn");
    if (closeLoginBtn) {
        closeLoginBtn.addEventListener("click", () => {
            const modal = document.getElementById("studentLoginModal");
            if (modal) {
                modal.classList.add("hidden");
                modal.classList.remove("modal-visible");
            }
        });
    } else {
        console.warn("closeStudentLoginBtn not found");
    }

    // Sidebar Navigation
    const navButtons = [
        { id: "studentHomeBtn", section: "studentHomeSection", action: loadHomeData },
        { id: "homeworkListBtn", section: "homeworkListSection", action: () => loadHomework(homework, studentData, 1) },
        { id: "submitHomeworkBtn", section: "submitHomeworkSection", action: () => updateFormOptions(homework) },
        { id: "attendanceBtn", section: "attendanceSection", action: () => loadAttendance(attendance, studentData) },
        { id: "sessionalMarksBtn", section: "sessionalMarksSection", action: () => loadSessionalMarks(sessionalMarks, 1) },
        { id: "studentAnalyticsBtn", section: "studentAnalyticsSection", action: () => loadAnalytics(homework, sessionalMarks, studentData) },
        { id: "studentSettingsBtn", section: "studentSettingsSection", action: () => {
            const settingsRollNumber = document.getElementById("settingsRollNumber");
            if (settingsRollNumber) settingsRollNumber.value = studentData?.rollNumber || "";
            updateClassDisplay(classes, studentData);
        }}
    ];
    navButtons.forEach(({ id, section, action }) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener("click", () => {
                toggleSection(section);
                action();
            });
        } else {
            console.warn(`Navigation button ${id} not found`);
        }
    });

    // Logout
    const logoutBtn = document.getElementById("studentLogoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            const cleanup = setupRealTimeListeners();
            await cleanup();
            await logout();
        });
    } else {
        console.warn("studentLogoutBtn not found");
    }

    // Submit Homework
    const submitHomeworkBtn = document.getElementById("submitHomeworkSubmitBtn");
    if (submitHomeworkBtn) {
        submitHomeworkBtn.addEventListener("click", async () => {
            const homeworkId = document.getElementById("homeworkSelect")?.value;
            const file = document.getElementById("submissionFile")?.files[0];
            const notes = document.getElementById("submissionNotes")?.value || "";
            if (!homeworkId || !file) {
                showNotification("Please select a homework and file!", "error");
                return;
            }
            if (!confirm("Are you sure you want to submit this homework?")) return;
            try {
                await submitHomework(homeworkId, file, notes);
                resetForm("submitHomeworkForm");
                toggleSection("homeworkListSection");
            } catch (error) {
                console.error("Error processing submission:", error);
                showNotification("Error processing submission: " + error.message, "error");
            }
        });
    } else {
        console.warn("submitHomeworkSubmitBtn not found");
    }

    // Filters and Pagination
    const homeworkSearchInput = document.getElementById("homeworkSearchInput");
    if (homeworkSearchInput) {
        homeworkSearchInput.addEventListener("input", () => loadHomework(homework, studentData, 1));
    }
    const homeworkStatusFilter = document.getElementById("homeworkStatusFilter");
    if (homeworkStatusFilter) {
        homeworkStatusFilter.addEventListener("change", () => loadHomework(homework, studentData, 1));
    }
    const homeworkPrevPageBtn = document.getElementById("homeworkPrevPageBtn");
    if (homeworkPrevPageBtn) {
        homeworkPrevPageBtn.addEventListener("click", () => loadHomework(homework, studentData, currentPage - 1));
    }
    const homeworkNextPageBtn = document.getElementById("homeworkNextPageBtn");
    if (homeworkNextPageBtn) {
        homeworkNextPageBtn.addEventListener("click", () => loadHomework(homework, studentData, currentPage + 1));
    }

    const attendanceDateFilter = document.getElementById("attendanceDateFilter");
    if (attendanceDateFilter) {
        attendanceDateFilter.addEventListener("change", () => loadAttendance(attendance, studentData));
    }

    const marksSearchInput = document.getElementById("marksSearchInput");
    if (marksSearchInput) {
        marksSearchInput.addEventListener("input", () => loadSessionalMarks(sessionalMarks, 1));
    }
    const marksExamTypeFilter = document.getElementById("marksExamTypeFilter");
    if (marksExamTypeFilter) {
        marksExamTypeFilter.addEventListener("change", () => loadSessionalMarks(sessionalMarks, 1));
    }
    const marksPrevPageBtn = document.getElementById("marksPrevPageBtn");
    if (marksPrevPageBtn) {
        marksPrevPageBtn.addEventListener("click", () => loadSessionalMarks(sessionalMarks, currentPage - 1));
    }
    const marksNextPageBtn = document.getElementById("marksNextPageBtn");
    if (marksNextPageBtn) {
        marksNextPageBtn.addEventListener("click", () => loadSessionalMarks(sessionalMarks, currentPage + 1));
    }

    // Test Attendance Fetch
    const testAttendanceBtn = document.getElementById("testAttendanceBtn");
    if (testAttendanceBtn) {
        testAttendanceBtn.addEventListener("click", async () => {
            try {
                showLoading();
                const data = await getData(`teachers/${teacherId}/attendance`);
                console.log("Manual attendance fetch:", JSON.stringify(data, null, 2));
                loadAttendance(data || {}, studentData);
                showNotification("Attendance fetched manually!", "success");
            } catch (error) {
                console.error("Manual attendance fetch error:", error);
                showNotification("Error fetching attendance: " + error.message, "error");
            } finally {
                hideLoading();
            }
        });
    } else {
        console.warn("testAttendanceBtn not found");
    }

    // Settings
    const themeSelect = document.getElementById("studentThemeSelect");
    if (themeSelect) {
        themeSelect.addEventListener("change", (e) => {
            const theme = e.target.value;
            document.documentElement.setAttribute("data-theme", theme);
            localStorage.setItem("theme", theme);
        });
    }

    // Homework Table Action Buttons
    const homeworkTableBody = document.querySelector("#homeworkTable tbody");
    if (homeworkTableBody) {
        homeworkTableBody.addEventListener("click", (e) => {
            if (e.target.classList.contains("submit-btn")) {
                const homeworkId = e.target.dataset.id;
                const homeworkSelect = document.getElementById("homeworkSelect");
                if (homeworkSelect) homeworkSelect.value = homeworkId;
                toggleSection("submitHomeworkSection");
                updateFormOptions(homework);
            }
        });
    } else {
        console.warn("homeworkTable tbody not found");
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const rollNumber = document.getElementById("studentLoginRollNumber")?.value.trim();
    const password = document.getElementById("studentLoginPassword")?.value;
    if (!rollNumber || !password) {
        showNotification("Please enter roll number and password", "error");
        return;
    }
    try {
        showLoading();
        const loginData = await studentLogin(rollNumber, password);
        teacherId = loginData.teacherUid;
        studentData = { id: loginData.id, ...loginData };
        console.log("Login successful, studentData:", JSON.stringify(studentData, null, 2));
        const loginModal = document.getElementById("studentLoginModal");
        const studentPanel = document.getElementById("studentPanel");
        if (loginModal && studentPanel) {
            loginModal.classList.add("hidden");
            loginModal.classList.remove("modal-visible");
            studentPanel.classList.remove("hidden");
        }
        showNotification("Login successful!");
        setupRealTimeListeners();
        loadHomeData();
    } catch (error) {
        console.error("Login error:", error);
        const errorEl = document.getElementById("studentLoginError");
        if (errorEl) {
            errorEl.textContent = error.message || "Failed to log in";
            errorEl.classList.remove("hidden");
            errorEl.classList.add("error-visible");
        }
        showNotification("Login failed: " + error.message, "error");
    } finally {
        hideLoading();
    }
}

window.onload = async () => {
    showLoading();
    initializeTheme();
    setupMobileMenu();
    setupEventListeners();

    const sessionData = await validateSession();
    if (sessionData) {
        teacherId = sessionData.teacherUid;
        studentData = { id: sessionData.id, ...sessionData };
        console.log("Session restored, studentData:", JSON.stringify(studentData, null, 2));
        const studentPanel = document.getElementById("studentPanel");
        const loginModal = document.getElementById("studentLoginModal");
        if (studentPanel && loginModal) {
            studentPanel.classList.remove("hidden");
            loginModal.classList.add("hidden");
            loginModal.classList.remove("modal-visible");
        }
        setupRealTimeListeners();
        loadHomeData();
    } else {
        console.log("No valid session, showing login modal");
        const studentPanel = document.getElementById("studentPanel");
        const loginModal = document.getElementById("studentLoginModal");
        if (studentPanel && loginModal) {
            studentPanel.classList.add("hidden");
            loginModal.classList.remove("hidden");
            loginModal.classList.add("modal-visible");
        }
    }
    hideLoading();
};