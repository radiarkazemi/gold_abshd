import { useEffect, useState } from "react";
import {
  fetchPermissionScopes,
  fetchSubAdmins,
  createSubAdmin,
  updateSubAdmin,
  deleteSubAdmin,
  fetchAdminActivity,
} from "../api";

function fa(n) {
  return Number(n).toLocaleString("fa-IR");
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fa-IR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const ACTION_LABEL = {
  login: "ورود",
  create_admin_user: "ایجاد مدیر جدید",
  update_admin_user: "ویرایش مدیر",
  delete_admin_user: "حذف مدیر",
};

export default function AdminAccountsTab() {
  const [scopes, setScopes] = useState([]);
  const [admins, setAdmins] = useState(null);
  const [activity, setActivity] = useState(null);
  const [view, setView] = useState("admins"); // "admins" | "activity"

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", full_name: "", phone_number: "", national_id: "", permissions: [] });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editPermissions, setEditPermissions] = useState([]);

  function reload() {
    fetchPermissionScopes().then(setScopes).catch(() => {});
    fetchSubAdmins().then(setAdmins).catch(() => {});
  }

  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (view === "activity" && !activity) {
      fetchAdminActivity().then(setActivity).catch(() => {});
    }
  }, [view, activity]);

  function toggleFormPermission(key) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key],
    }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setFormError("");
    if (!form.username || !form.password || !form.full_name || !form.phone_number || !form.national_id) {
      setFormError("همه فیلدها الزامی است");
      return;
    }
    setBusy(true);
    try {
      await createSubAdmin(form);
      setForm({ username: "", password: "", full_name: "", phone_number: "", national_id: "", permissions: [] });
      setCreating(false);
      reload();
    } catch (err) {
      setFormError(err.message || "ایجاد مدیر با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  function startEditPermissions(admin) {
    setEditingId(admin.id);
    setEditPermissions(admin.permissions);
  }

  function toggleEditPermission(key) {
    setEditPermissions((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  }

  async function saveEditPermissions(adminId) {
    setBusy(true);
    try {
      await updateSubAdmin(adminId, { permissions: editPermissions });
      setEditingId(null);
      reload();
    } catch (err) {
      alert(err.message || "ویرایش با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(admin) {
    setBusy(true);
    try {
      await updateSubAdmin(admin.id, { is_active: !admin.is_active });
      reload();
    } catch (err) {
      alert(err.message || "تغییر وضعیت با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(admin) {
    if (!confirm(`حساب مدیر «${admin.full_name}» حذف شود؟`)) return;
    setBusy(true);
    try {
      await deleteSubAdmin(admin.id);
      reload();
    } catch (err) {
      alert(err.message || "حذف با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-accounts">
      <div className="admin-accounts__tabs">
        <button
          className={view === "admins" ? "admin-accounts__tab is-active" : "admin-accounts__tab"}
          onClick={() => setView("admins")}
        >
          مدیران فرعی
        </button>
        <button
          className={view === "activity" ? "admin-accounts__tab is-active" : "admin-accounts__tab"}
          onClick={() => setView("activity")}
        >
          گزارش فعالیت‌ها
        </button>
      </div>

      {view === "admins" ? (
        <>
          <div className="dashboard__section-head">
            <h3 className="dashboard__section-title">مدیران فرعی (حسابدار، مدیر و غیره)</h3>
            <button className="dashboard__see-all" onClick={() => setCreating((c) => !c)}>
              {creating ? "بستن ‹" : "+ مدیر جدید"}
            </button>
          </div>

          {creating && (
            <form className="admin-accounts__create-form" onSubmit={handleCreate}>
              {formError && <p className="admin-accounts__error">{formError}</p>}
              <div className="admin-accounts__create-grid">
                <label className="order-limits-box__field">
                  <span>نام کاربری</span>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} dir="ltr" />
                </label>
                <label className="order-limits-box__field">
                  <span>رمز عبور</span>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" />
                </label>
                <label className="order-limits-box__field">
                  <span>نام کامل</span>
                  <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </label>
                <label className="order-limits-box__field">
                  <span>شماره موبایل</span>
                  <input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} dir="ltr" placeholder="09xxxxxxxxx" />
                </label>
                <label className="order-limits-box__field">
                  <span>کد ملی</span>
                  <input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} dir="ltr" />
                </label>
              </div>
              <div className="admin-accounts__scopes">
                <span className="admin-accounts__scopes-label">دسترسی‌ها:</span>
                <div className="admin-accounts__scope-chips">
                  {scopes.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      className={form.permissions.includes(s.key) ? "admin-accounts__chip is-on" : "admin-accounts__chip"}
                      onClick={() => toggleFormPermission(s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <button className="order-limits-box__save" type="submit" disabled={busy}>
                {busy ? "در حال ایجاد…" : "ایجاد مدیر"}
              </button>
            </form>
          )}

          {!admins ? (
            <p className="myorders__empty">در حال بارگذاری…</p>
          ) : admins.length === 0 ? (
            <p className="myorders__empty">هنوز مدیر فرعی‌ای ایجاد نشده.</p>
          ) : (
            <div className="admin-accounts__list">
              {admins.map((admin) => (
                <div key={admin.id} className={`admin-accounts__card ${!admin.is_active ? "is-inactive" : ""}`}>
                  <div className="admin-accounts__card-top">
                    <div>
                      <span className="admin-accounts__name">{admin.full_name}</span>
                      <span className="admin-accounts__username" dir="ltr">@{admin.username}</span>
                    </div>
                    <span className={`admin-accounts__status ${admin.is_active ? "is-on" : "is-off"}`}>
                      {admin.is_active ? "فعال" : "غیرفعال"}
                    </span>
                  </div>

                  <div className="admin-accounts__meta">
                    <span>موبایل: <span dir="ltr">{admin.phone_number || "—"}</span></span>
                    <span>کد ملی: <span dir="ltr">{admin.national_id || "—"}</span></span>
                    <span>ایجاد شده توسط: {admin.created_by || "—"}</span>
                    <span>آخرین ورود: {formatDate(admin.last_login_at)}</span>
                  </div>

                  {admin.registration_key && (
                    <div className="reg-key-box reg-key-box--compact">
                      <span className="reg-key-box__key" dir="ltr">{admin.registration_key}</span>
                      <span className={`reg-key-box__status reg-key-box__status--${admin.activated ? "active" : "pending"}`}>
                        {admin.activated ? "فعال‌سازی شده" : "در انتظار اولین ورود"}
                      </span>
                      {!admin.activated && (
                        <span className="admin-accounts__key-expiry">
                          اعتبار تا: {new Date(admin.registration_key_expires_at).toLocaleDateString("fa-IR")}
                        </span>
                      )}
                    </div>
                  )}

                  {editingId === admin.id ? (
                    <>
                      <div className="admin-accounts__scope-chips">
                        {scopes.map((s) => (
                          <button
                            type="button"
                            key={s.key}
                            className={editPermissions.includes(s.key) ? "admin-accounts__chip is-on" : "admin-accounts__chip"}
                            onClick={() => toggleEditPermission(s.key)}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <div className="admin-accounts__actions">
                        <button className="order-limits-box__save" disabled={busy} onClick={() => saveEditPermissions(admin.id)}>
                          ذخیره دسترسی‌ها
                        </button>
                        <button className="dashboard__see-all" onClick={() => setEditingId(null)}>انصراف</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="admin-accounts__scope-chips">
                        {admin.permissions.length === 0 ? (
                          <span className="admin-accounts__no-scope">بدون دسترسی</span>
                        ) : (
                          admin.permissions.map((p) => (
                            <span className="admin-accounts__chip is-on" key={p}>
                              {scopes.find((s) => s.key === p)?.label || p}
                            </span>
                          ))
                        )}
                      </div>
                      <div className="admin-accounts__actions">
                        <button className="dashboard__see-all" onClick={() => startEditPermissions(admin)}>ویرایش دسترسی</button>
                        <button className="dashboard__see-all" onClick={() => toggleActive(admin)}>
                          {admin.is_active ? "غیرفعال کردن" : "فعال کردن"}
                        </button>
                        <button className="admin-accounts__delete" onClick={() => handleDelete(admin)}>حذف</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <h3 className="dashboard__section-title">گزارش فعالیت‌های مدیران</h3>
          {!activity ? (
            <p className="myorders__empty">در حال بارگذاری…</p>
          ) : activity.length === 0 ? (
            <p className="myorders__empty">فعالیتی ثبت نشده.</p>
          ) : (
            <div className="admin-accounts__activity-list">
              {activity.map((a) => (
                <div className="admin-accounts__activity-row" key={a.id}>
                  <span className={`admin-accounts__activity-actor ${a.is_super ? "is-super" : ""}`}>
                    {a.actor_username}{a.is_super ? " (مدیر اصلی)" : ""}
                  </span>
                  <span className="admin-accounts__activity-action">{ACTION_LABEL[a.action] || a.action}</span>
                  {a.detail && <span className="admin-accounts__activity-detail">{a.detail}</span>}
                  <span className="admin-accounts__activity-time">{formatDate(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}