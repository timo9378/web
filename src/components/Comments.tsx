import React, { useState, useEffect, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import KoimLoader from './KoimLoader';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/auth';
import { FaGithub, FaGoogle } from 'react-icons/fa';
import type { CommentRow } from '@koimsurai/api-types';
import { commentsQueryOptions } from '../commentsData';
import './Comments.css';

interface ReplyTarget { id: number; author: string }

interface CommentsProps {
  postId: number | string;
  allowComments?: boolean;
  basePath?: string;
}

function Comments({ postId, allowComments = true, basePath = 'posts' }: CommentsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // 留言列表改由 TanStack Query 讀；送出/按讚後 invalidate / setQueryData 更新同一份快取。
  const commentsKey = commentsQueryOptions(basePath, postId).queryKey;
  const { data: comments = [], isPending: loadingList } = useQuery(commentsQueryOptions(basePath, postId));
  const [newComment, setNewComment] = useState('');
  const [author, setAuthor] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [likedComments, setLikedComments] = useState<number[]>([]);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaQuestion, setCaptchaQuestion] = useState<{ num1: number; num2: number }>({ num1: 0, num2: 0 });
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null); // { id, author } or null
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [useAnonymous, setUseAnonymous] = useState(false); // 是否使用匿名模式
  const [commentMode, setCommentMode] = useState('initial'); // 'initial' | 'login' | 'anonymous'

  const { user, isLoggedIn, providers, getGoogleAuthUrl, getGitHubAuthUrl, getToken } = useAuth();

  // set-state-in-effect 在 SSR 站台無解，不是缺陷：localStorage 在 server 上不存在，
  // 改用 useState 的 lazy initializer 會炸；就算加 typeof window 守衛，也只會變成
  // server 繪預設值、client 繪儲存值 → hydration mismatch。讀 client-only 儲存
  // 本來就該在 effect。captcha 同理（Math.random 進 render 期會 server/client 不一致）。
  /* eslint-disable @eslint-react/set-state-in-effect */
  useEffect(() => {
    const liked = JSON.parse(localStorage.getItem('liked_comments_' + basePath + '_' + postId) ?? '[]') as number[];
    setLikedComments(liked);
    generateCaptcha();
    // Restore saved author info
    const savedAuthor = localStorage.getItem('comment_author');
    const savedEmail = localStorage.getItem('comment_email');
    const savedWebsite = localStorage.getItem('comment_website');
    if (savedAuthor) setAuthor(savedAuthor);
    if (savedEmail) setEmail(savedEmail);
    if (savedWebsite) setWebsite(savedWebsite);
  }, [postId, basePath]);

  const generateCaptcha = () => {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    setCaptchaQuestion({ num1, num2 });
  };
  /* eslint-enable @eslint-react/set-state-in-effect */

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const isUsingLogin = isLoggedIn && !useAnonymous;

    if (!newComment.trim()) {
      setError(t('comments.errorEmpty'));
      return;
    }

    // 匿名模式需要暱稱和驗證碼
    if (!isUsingLogin) {
      if (!author.trim()) {
        setError(t('comments.errorNoName'));
        return;
      }
      const expectedAnswer = captchaQuestion.num1 + captchaQuestion.num2;
      if (parseInt(captchaAnswer, 10) !== expectedAnswer) {
        setError(t('comments.errorCaptcha'));
        generateCaptcha();
        setCaptchaAnswer('');
        return;
      }
    }

    setIsLoading(true);
    setError('');

    // 匿名模式保存資料
    if (!isUsingLogin) {
      localStorage.setItem('comment_author', author);
      localStorage.setItem('comment_email', email);
      localStorage.setItem('comment_website', website);
    }

    const submitAuthor = isUsingLogin ? (user?.displayName ?? '') : author;
    const submitEmail = isUsingLogin ? (user?.email ?? '') : email;
    const expectedAnswer = captchaQuestion.num1 + captchaQuestion.num2;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isUsingLogin) {
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch('/api/' + basePath + '/' + postId + '/comments', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          author: submitAuthor,
          content: replyTo ? '@' + replyTo.author + ' ' + newComment : newComment,
          email: submitEmail,
          website: isUsingLogin ? '' : website,
          avatar_url: isUsingLogin ? (user?.avatar ?? '') : '',
          provider: isUsingLogin ? (user?.provider ?? '') : '',
          parent_id: replyTo ? replyTo.id : null,
          ...(!isUsingLogin && { captcha: parseInt(captchaAnswer, 10), captchaAnswer: expectedAnswer }),
        }),
      });

      if (response.ok) {
        setNewComment('');
        setCaptchaAnswer('');
        setReplyTo(null);
        generateCaptcha();
        setSubmitSuccess(true);
        setTimeout(() => setSubmitSuccess(false), 5000);
        void queryClient.invalidateQueries({ queryKey: commentsKey });
      } else {
        const errorData = await response.json() as { error?: string };
        setError(errorData.error ?? t('comments.errorFailed'));
      }
    } catch {
      setError(t('comments.errorFailedTryLater'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleLike = async (commentId: number) => {
    if (likedComments.includes(commentId)) return;

    try {
      const response = await fetch('/api/comments/' + commentId + '/like', { method: 'POST' });
      if (response.ok) {
        const data = await response.json() as { likes: number };
        queryClient.setQueryData<CommentRow[]>(commentsKey, (old) =>
          (old ?? []).map((comment) =>
            comment.id === commentId ? { ...comment, likes: data.likes } : comment,
          ),
        );
        const newLiked = [...likedComments, commentId];
        setLikedComments(newLiked);
        localStorage.setItem('liked_comments_' + basePath + '_' + postId, JSON.stringify(newLiked));
      }
    } catch (error) {
      console.error('Error liking comment:', error);
    }
  };

  const getAvatarColor = (name: string) => {
    const colors = ['#7f5af0', '#2cb67d', '#e53170', '#ff8906', '#3da9fc', '#ef4444', '#8b5cf6', '#06b6d4'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const formatDate = (dateStr: string) => {
    // SQLite CURRENT_TIMESTAMP 是 UTC，需要加 Z 後綴確保正確解析
    const d = new Date(dateStr.includes('T') || dateStr.includes('Z') ? dateStr : dateStr + 'Z');
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return t('common.justNow');
    if (mins < 60) return t('common.minutesAgo', { count: mins });
    if (hrs < 24) return t('common.hoursAgo', { count: hrs });
    if (days < 7) return t('common.daysAgo', { count: days });
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // 判斷當前是否使用登入模式
  const isUsingLogin = isLoggedIn && !useAnonymous;

  return (
    <div className="comments-block">
      {/* ── Comment Form ── */}
      <div className="comment-form-card">
        {(isLoggedIn || commentMode === 'anonymous') && (
          <div className="form-avatar">
            <div className="avatar-circle" style={{
              background: isUsingLogin
                ? 'transparent'
                : (author ? getAvatarColor(author) : 'rgba(127,90,240,0.3)'),
              padding: 0,
              overflow: 'hidden',
            }}>
              {isUsingLogin && user?.avatar ? (
                <img src={user.avatar} alt={user.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} referrerPolicy="no-referrer" />
              ) : (
                author ? author.charAt(0).toUpperCase() : '?'
              )}
            </div>
          </div>
        )}

        {!allowComments && (
          <div className="comment-closed-notice">
            {t('comments.closedNotice')}
          </div>
        )}

        {/* WebMCP 宣告式工具：這張表單「載入即在 DOM 裡」，跟藏在 modal 的訂閱表單不同，
            瀏覽器內的 agent 與 Lighthouse 的 Agentic Browsing 稽核才掃得到。
            注意：下面的欄位仍受 commentMode 控制，未展開時只有表單本身帶標註、參數還看不到。 */}
        {allowComments && (
        <form
          onSubmit={(e) => { void handleSubmit(e); }}
          className="comment-form"
          toolname="post_comment"
          tooldescription="在這篇文章底下留言，可具名或匿名"
        >
          {/* ── 模式切換 ── */}
          <div className="comment-mode-switch">
            {isLoggedIn ? (
              <>
                <button type="button" className={`mode-btn ${!useAnonymous ? 'active' : ''}`} onClick={() => setUseAnonymous(false)}>
                  {user?.avatar && <img src={user.avatar} className="mode-avatar" referrerPolicy="no-referrer" alt="" />}
                  {user?.displayName}
                </button>
                <button type="button" className={`mode-btn ${useAnonymous ? 'active' : ''}`} onClick={() => setUseAnonymous(true)}>
                  {t('comments.anonymousLabel')}
                </button>
              </>
            ) : (
              <div className="comment-login-area">
                {commentMode === 'initial' && (
                  <div className="comment-mode-buttons">
                    <button type="button" className="mode-btn mode-btn--login" onClick={() => setCommentMode('login')}>
                      🔑 {t('user.signInLabel')}
                    </button>
                    <button type="button" className="mode-btn mode-btn--anon" onClick={() => setCommentMode('anonymous')}>
                      👤 {t('comments.anonymousLabel')}
                    </button>
                  </div>
                )}
                {commentMode === 'login' && (
                  <div className="comment-login-expand">
                    <div className="login-expand-header">
                      <span className="login-label">{t('comments.loginLabel')}</span>
                      <button type="button" className="back-btn" onClick={() => setCommentMode('initial')}>← {t('comments.back')}</button>
                    </div>
                    <div className="login-providers">
                      {providers.github?.enabled && (
                        <button type="button" className="provider-btn" onClick={() => {
                          sessionStorage.setItem('oauth_return_to', window.location.pathname);
                          window.location.href = getGitHubAuthUrl(`${window.location.origin}/auth/callback`) + '&state=github';
                        }}>
                          <FaGithub /> <span>GitHub</span>
                        </button>
                      )}
                      {providers.google?.enabled && (
                        <button type="button" className="provider-btn" onClick={() => {
                          sessionStorage.setItem('oauth_return_to', window.location.pathname);
                          window.location.href = getGoogleAuthUrl(`${window.location.origin}/auth/callback`) + '&state=google';
                        }}>
                          <FaGoogle /> <span>Google</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {commentMode === 'anonymous' && (
                  <div className="comment-anon-expand">
                    <div className="login-expand-header">
                      <span className="login-label">{t('comments.anonymousLabel')}</span>
                      <button type="button" className="back-btn" onClick={() => setCommentMode('initial')}>← {t('comments.back')}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 匿名模式欄位（登入後切匿名 或 未登入選匿名）── */}
          {((!isLoggedIn && commentMode === 'anonymous') || (isLoggedIn && useAnonymous)) && (
            <div className="form-fields">
              <div className="field-group">
                <input
                  type="text"
                  name="author"
                  toolparamdescription="留言者顯示名稱（必填）"
                  placeholder={t('comments.namePlaceholder')}
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  required
                  className="field-input"
                />
              </div>
              <div className="field-group">
                <input
                  type="email"
                  name="email"
                  toolparamdescription="聯絡用 email（選填，不公開）"
                  placeholder={t('comments.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field-input"
                />
              </div>
              <div className="field-group">
                <input
                  type="url"
                  name="website"
                  toolparamdescription="個人網站網址（選填）"
                  placeholder={t('comments.websitePlaceholder')}
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="field-input"
                />
              </div>
            </div>
          )}

          {/* ── 留言區域（登入後 或 匿名模式展開時顯示）── */}
          {(isLoggedIn || commentMode === 'anonymous') && (
            <>
              <div className="textarea-wrap">
                {replyTo && (
                  <div className="reply-indicator">
                    <span>{t('comments.reply')} @{replyTo.author}</span>
                    <button type="button" onClick={() => setReplyTo(null)}>✕</button>
                  </div>
                )}
                <textarea
                  name="content"
                  toolparamdescription="留言內容（必填）"
                  placeholder={t('comments.contentPlaceholder')}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  required
                  rows={4}
                  className="comment-textarea"
                />
              </div>

              <div className="form-actions">
                {!isUsingLogin && (
                  <div className="captcha-area">
                    <span className="captcha-q">{captchaQuestion.num1} + {captchaQuestion.num2} = </span>
                    <input
                      type="number"
                      placeholder="?"
                      value={captchaAnswer}
                      onChange={(e) => setCaptchaAnswer(e.target.value)}
                      required
                      className="captcha-input"
                    />
                  </div>
                )}
                {isUsingLogin && <div />}
                <button type="submit" disabled={isLoading} className="submit-btn">
                  {isLoading ? (
                    <span className="spinner" />
                  ) : t('common.send')}
                </button>
              </div>
            </>
          )}

          <AnimatePresence>
            {error && (
              <motion.p
                className="form-error"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {error}
              </motion.p>
            )}
            {submitSuccess && (
              <motion.p
                className="form-success"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {isUsingLogin
                  ? t('comments.submitted')
                  : t('comments.submittedAwaitReview')}
              </motion.p>
            )}
          </AnimatePresence>
        </form>
        )}
      </div>

      {/* ── Comments List ── */}
      <div className="comments-list">
        {loadingList && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <KoimLoader inline size="sm" />
          </div>
        )}
        <div className="comments-header" style={loadingList ? { display: 'none' } : undefined}>
          <h3>{comments.length > 0 ? t('comments.titleN', { count: comments.length }) : t('comments.titleEmpty')}</h3>
        </div>

        <AnimatePresence>
          {comments.length > 0 ? (
            comments.map((comment, idx) => {
              const isAdmin = comment.is_admin === 1;
              // 找出回覆此留言的所有留言（管理員 + 用戶）
              const replies = comments.filter(c => c.parent_id === comment.id);
              // 如果此留言本身是子留言（回覆），跳過它的獨立渲染
              if (comment.parent_id) return null;

              return (
                <React.Fragment key={comment.id}>
                  <motion.div
                    className={`comment-card ${isAdmin ? 'comment-card--admin' : ''}`}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <div className="comment-left">
                      <div className="comment-avatar" style={{ background: isAdmin ? '#7f5af0' : (comment.avatar_url ? 'transparent' : getAvatarColor(comment.author)), overflow: 'hidden' }}>
                        {isAdmin ? '✦' : (comment.avatar_url
                          ? <img src={comment.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} referrerPolicy="no-referrer" />
                          : comment.author.charAt(0).toUpperCase()
                        )}
                      </div>
                      {(idx < comments.filter(c => !c.parent_id).length - 1 || replies.length > 0) && <div className="comment-line" />}
                    </div>

                    <div className="comment-body">
                      <div className="comment-meta">
                        <span className="comment-author">{comment.author}</span>
                        {isAdmin && <span className="admin-badge">{t('comments.authorBadge')}</span>}
                        <span className="comment-time">{formatDate(comment.created_at)}</span>
                      </div>
                      <p className="comment-text">{comment.content}</p>
                      <div className="comment-actions">
                        <button
                          className={'action-btn like ' + (likedComments.includes(comment.id) ? 'liked' : '')}
                          onClick={() => { void handleLike(comment.id); }}
                          disabled={likedComments.includes(comment.id)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={likedComments.includes(comment.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                          </svg>
                          <span>{comment.likes}</span>
                        </button>
                        <button className="action-btn reply" onClick={() => { setReplyTo({ id: comment.id, author: comment.author }); document.querySelector<HTMLTextAreaElement>('.comment-textarea')?.focus(); }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                          </svg>
                          <span>{t('comments.reply')}</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>

                  {/* All replies to this comment (admin + user) */}
                  {replies.map((reply) => {
                    const isReplyAdmin = reply.is_admin === 1;
                    return (
                      <motion.div key={reply.id} className={`comment-card comment-card--reply ${isReplyAdmin ? 'comment-card--admin' : ''}`}
                        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                        <div className="comment-left">
                          <div className="comment-avatar" style={{
                            background: isReplyAdmin ? '#7f5af0' : (reply.avatar_url ? 'transparent' : getAvatarColor(reply.author)),
                            overflow: 'hidden',
                          }}>
                            {isReplyAdmin ? '✦' : (reply.avatar_url
                              ? <img src={reply.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} referrerPolicy="no-referrer" />
                              : reply.author.charAt(0).toUpperCase()
                            )}
                          </div>
                        </div>
                        <div className="comment-body">
                          <div className="comment-meta">
                            <span className="comment-author">{reply.author}</span>
                            {isReplyAdmin && <span className="admin-badge">{t('comments.authorBadge')}</span>}
                            <span className="comment-reply-to">{t('comments.reply')} @{comment.author}</span>
                            <span className="comment-time">{formatDate(reply.created_at)}</span>
                          </div>
                          <p className="comment-text">{reply.content}</p>
                          <div className="comment-actions">
                            <button
                              className={'action-btn like ' + (likedComments.includes(reply.id) ? 'liked' : '')}
                              onClick={() => { void handleLike(reply.id); }}
                              disabled={likedComments.includes(reply.id)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill={likedComments.includes(reply.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                              </svg>
                              <span>{reply.likes}</span>
                            </button>
                            <button className="action-btn reply" onClick={() => { setReplyTo({ id: comment.id, author: reply.author }); document.querySelector<HTMLTextAreaElement>('.comment-textarea')?.focus(); }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                              </svg>
                              <span>{t('comments.reply')}</span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </React.Fragment>
              );
            })
          ) : (
            <motion.div
              className="no-comments"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p>{t('comments.beFirst')}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default Comments;
